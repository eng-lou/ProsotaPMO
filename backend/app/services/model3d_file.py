from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model3d_file import Model3DFile
from app.schemas.model3d_file import Model3DFileResponse, Model3DKind, PresignedUpload, UnloadedElementInfo, UpAxis
from app.services import object_storage

STORAGE_PREFIX = "model3d"


async def list_files(db: AsyncSession, project_id: uuid.UUID) -> list[Model3DFileResponse]:
    rows = (await db.execute(
        select(Model3DFile).where(Model3DFile.project_id == project_id).order_by(Model3DFile.created_at)
    )).scalars().all()
    return [Model3DFileResponse.model_validate(r) for r in rows]


# Step 1 of the direct-to-R2 upload (2026-08-23) — see object_storage.py's
# own header. presigned_put_url is pure local HMAC signing, no network call,
# so this stays a plain sync function unlike everything below that actually
# talks to R2.
def presign_upload(name: str, content_type: str) -> PresignedUpload:
    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, name)
    upload_url = object_storage.presigned_put_url(storage_key, content_type)
    return PresignedUpload(storage_key=storage_key, upload_url=upload_url)


# Step 2 — the browser has already PUT the file's own bytes straight to R2
# by the time this runs; this only ever handles metadata (2026-08-23,
# replacing the old direct multipart-upload version this file had before
# Vercel's 4.5MB Function body cap made that impossible in production).
# size_bytes is read back from R2 itself (head_object_size), not trusted
# from the client, so a stale/lied-about value can't corrupt it.
async def create_file(
    db: AsyncSession, project_id: uuid.UUID, name: str, kind: Model3DKind, source_up_axis: UpAxis,
    storage_key: str, keep_raw_animation: bool = False,
) -> Model3DFileResponse:
    # Re-importing a file with the same name/kind REPLACES the existing one
    # rather than accumulating a new row alongside it — see this function's
    # own pre-R2 history for the full "why" (a real incident: 5 duplicate
    # imports of the same file in one day). Deliberately cascades anything
    # FK'd to the old row (SectionBox, ElementTransform), same as before.
    existing = (await db.execute(
        select(Model3DFile).where(
            Model3DFile.project_id == project_id, Model3DFile.name == name, Model3DFile.kind == kind,
        )
    )).scalar_one_or_none()
    if existing is not None:
        await run_in_threadpool(object_storage.delete_object, existing.storage_filename)
        await db.delete(existing)
        await db.flush()

    try:
        size = await run_in_threadpool(object_storage.head_object_size, storage_key)
    except Exception:
        raise HTTPException(
            status_code=400, detail="Uploaded file not found in storage — the upload may have failed or expired",
        ) from None

    row = Model3DFile(
        project_id=project_id, name=name, kind=kind, source_up_axis=source_up_axis,
        storage_filename=storage_key, size_bytes=size, keep_raw_animation=keep_raw_animation,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return Model3DFileResponse.model_validate(row)


# Used by site_capture.py's own generate_ifc (Cloud2BIM integration — an
# .ifc generated server-side from a SiteCapture's point cloud, not a
# browser upload) — same replace-on-reimport convention as create_file
# above, just uploading an already-local temp file to R2 instead of
# recording a browser-uploaded storage_key directly.
async def create_file_from_path(
    db: AsyncSession, project_id: uuid.UUID, name: str, kind: Model3DKind, source_up_axis: UpAxis, source_path: Path,
) -> Model3DFileResponse:
    existing = (await db.execute(
        select(Model3DFile).where(
            Model3DFile.project_id == project_id, Model3DFile.name == name, Model3DFile.kind == kind,
        )
    )).scalar_one_or_none()
    if existing is not None:
        await run_in_threadpool(object_storage.delete_object, existing.storage_filename)
        await db.delete(existing)
        await db.flush()

    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, name)
    await run_in_threadpool(object_storage.upload_from_path, storage_key, source_path)
    size = source_path.stat().st_size

    row = Model3DFile(
        project_id=project_id, name=name, kind=kind, source_up_axis=source_up_axis,
        storage_filename=storage_key, size_bytes=size,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return Model3DFileResponse.model_validate(row)


# Redirects to a presigned R2 GET url (2026-08-23) — a large model's bytes
# streaming back through this backend's own Function would hit Vercel's
# matching response-body cap, same reasoning as the upload side. The
# frontend's own axios GET (responseType: 'blob') follows a 307
# transparently, so this needed no frontend change.
async def get_download(db: AsyncSession, file_id: uuid.UUID) -> RedirectResponse:
    row = await db.get(Model3DFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Model file not found")
    url = await run_in_threadpool(object_storage.presigned_get_url, row.storage_filename)
    return RedirectResponse(url)


async def delete_file(db: AsyncSession, file_id: uuid.UUID) -> None:
    row = await db.get(Model3DFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Model file not found")
    await run_in_threadpool(object_storage.delete_object, row.storage_filename)
    await db.delete(row)
    await db.commit()


# "Unload Selected"/"Reload IFC" (2026-07-26, per Maro) — full replacement,
# not an append/remove-by-guid endpoint: the frontend always resolves the
# complete authoritative set (whichever elements are currently gone from the
# loaded scene) before calling this, the same "send the whole current state"
# convention CameraView.viewport_state already uses, so there's no risk of
# this drifting from what's actually unloaded client-side.
async def update_unloaded_elements(
    db: AsyncSession, file_id: uuid.UUID, unloaded_elements: list[UnloadedElementInfo],
) -> Model3DFileResponse:
    row = await db.get(Model3DFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Model file not found")
    row.unloaded_elements = [e.model_dump() for e in unloaded_elements]
    await db.commit()
    await db.refresh(row)
    return Model3DFileResponse.model_validate(row)
