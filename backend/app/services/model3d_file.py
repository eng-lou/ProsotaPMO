from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model3d_file import Model3DFile
from app.schemas.model3d_file import Model3DFileResponse, Model3DKind, UnloadedElementInfo, UpAxis
from app.services.model3d_storage import delete_stored_file, generate_storage_filename, storage_path

# A defensive cap, not a tuned production limit — this app has no CDN/chunked
# upload infrastructure yet, so a single request just streams straight to
# local disk (see model3d_storage.py); 1GB is generous headroom for a real
# federated IFC/GLTF model while still catching an obviously-wrong upload
# (e.g. a browser retry loop) before it fills the disk.
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024


async def list_files(db: AsyncSession, project_id: uuid.UUID) -> list[Model3DFileResponse]:
    rows = (await db.execute(
        select(Model3DFile).where(Model3DFile.project_id == project_id).order_by(Model3DFile.created_at)
    )).scalars().all()
    return [Model3DFileResponse.model_validate(r) for r in rows]


async def create_file(
    db: AsyncSession, project_id: uuid.UUID, name: str, kind: Model3DKind, source_up_axis: UpAxis, upload: UploadFile,
    keep_raw_animation: bool = False,
) -> Model3DFileResponse:
    # Re-importing a file with the same name/kind REPLACES the existing one
    # rather than accumulating a new row alongside it (2026-07-11, per a
    # real incident: the frontend's own restore-on-mount effect was slow/
    # unreliable enough in practice that a user re-imported the same ~15MB
    # IFC file 5 separate times across one day, leaving 5 full duplicate
    # copies in the database and on disk, each restore slower than the
    # last). Deleting the prior row first (not overwriting its bytes in
    # place) deliberately cascades anything FK'd to it -- SectionBox,
    # ElementTransform -- consistent with how those tables already treat a
    # "re-import" as potentially-different geometry, not guaranteed to be
    # the same file (see section_box.py's own docstring on why it uses a
    # real FK instead of ModelElementLink's loose filename identity).
    existing = (await db.execute(
        select(Model3DFile).where(
            Model3DFile.project_id == project_id, Model3DFile.name == name, Model3DFile.kind == kind,
        )
    )).scalar_one_or_none()
    if existing is not None:
        delete_stored_file(existing.storage_filename)
        await db.delete(existing)
        await db.flush()

    storage_filename = generate_storage_filename(name)
    dest = storage_path(storage_filename)
    size = 0
    try:
        with open(dest, "wb") as out:
            while chunk := await upload.read(CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File too large")
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to save uploaded file")

    row = Model3DFile(
        project_id=project_id, name=name, kind=kind, source_up_axis=source_up_axis,
        storage_filename=storage_filename, size_bytes=size, keep_raw_animation=keep_raw_animation,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return Model3DFileResponse.model_validate(row)


# Used by site_capture.py's own generate_ifc (2026-08-20, Cloud2BIM
# integration — an .ifc generated server-side from a SiteCapture's point
# cloud, not an upload) — same replace-on-reimport convention as
# create_file above (re-running "Generate IFC" against the same capture
# should replace its own prior result, not accumulate duplicates), just
# copying from an already-on-disk file instead of streaming an UploadFile.
async def create_file_from_path(
    db: AsyncSession, project_id: uuid.UUID, name: str, kind: Model3DKind, source_up_axis: UpAxis, source_path: Path,
) -> Model3DFileResponse:
    existing = (await db.execute(
        select(Model3DFile).where(
            Model3DFile.project_id == project_id, Model3DFile.name == name, Model3DFile.kind == kind,
        )
    )).scalar_one_or_none()
    if existing is not None:
        delete_stored_file(existing.storage_filename)
        await db.delete(existing)
        await db.flush()

    storage_filename = generate_storage_filename(name)
    dest = storage_path(storage_filename)
    shutil.copyfile(source_path, dest)
    size = dest.stat().st_size

    row = Model3DFile(
        project_id=project_id, name=name, kind=kind, source_up_axis=source_up_axis,
        storage_filename=storage_filename, size_bytes=size,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return Model3DFileResponse.model_validate(row)


async def get_download(db: AsyncSession, file_id: uuid.UUID) -> FileResponse:
    row = await db.get(Model3DFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Model file not found")
    path = storage_path(row.storage_filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored file is missing on disk")
    return FileResponse(path, filename=row.name, media_type="application/octet-stream")


async def delete_file(db: AsyncSession, file_id: uuid.UUID) -> None:
    row = await db.get(Model3DFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Model file not found")
    delete_stored_file(row.storage_filename)
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
