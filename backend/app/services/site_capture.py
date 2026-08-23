from __future__ import annotations

import tempfile
import uuid
from datetime import date
from pathlib import Path

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.site_capture import SiteCapture
from app.schemas.model3d_file import Model3DFileResponse
from app.schemas.site_capture import PresignedUpload, SiteCaptureKind, SiteCaptureResponse, SiteCaptureUpdate, UpAxis
from app.services import object_storage
from app.services.cloud2bim_convert import Cloud2BimError, generate_ifc_from_xyz
from app.services.e57_convert import convert_e57_to_xyz
from app.services.model3d_file import create_file_from_path

STORAGE_PREFIX = "site-captures"


async def list_captures(db: AsyncSession, project_id: uuid.UUID) -> list[SiteCaptureResponse]:
    rows = (await db.execute(
        select(SiteCapture).where(SiteCapture.project_id == project_id).order_by(SiteCapture.captured_at)
    )).scalars().all()
    return [SiteCaptureResponse.model_validate(r) for r in rows]


# Direct-to-R2 upload (2026-08-23) — see object_storage.py's own header for
# the full "why" (Vercel's hard 4.5MB Function body cap); this one matters
# even more here than for model3d_file.py — a real raw .e57 export
# routinely runs into the GB range (MAX_UPLOAD_BYTES below is a defensive
# 20GB cap, not a typical size), so there was never any question of this
# working through a 4.5MB-capped Function body in production.
def presign_upload(name: str, content_type: str) -> PresignedUpload:
    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, name)
    upload_url = object_storage.presigned_put_url(storage_key, content_type)
    return PresignedUpload(storage_key=storage_key, upload_url=upload_url)


async def create_capture(
    db: AsyncSession, project_id: uuid.UUID, name: str, captured_at: date,
    kind: SiteCaptureKind, source_up_axis: UpAxis, storage_key: str,
) -> SiteCaptureResponse:
    try:
        size = await run_in_threadpool(object_storage.head_object_size, storage_key)
    except Exception:
        raise HTTPException(
            status_code=400, detail="Uploaded file not found in storage — the upload may have failed or expired",
        ) from None

    row = SiteCapture(
        project_id=project_id, name=name, captured_at=captured_at, kind=kind, source_up_axis=source_up_axis,
        storage_filename=storage_key, size_bytes=size,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return SiteCaptureResponse.model_validate(row)


async def update_capture(db: AsyncSession, capture_id: uuid.UUID, data: SiteCaptureUpdate) -> SiteCaptureResponse:
    row = await db.get(SiteCapture, capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Site capture not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return SiteCaptureResponse.model_validate(row)


# Redirects to a presigned R2 GET url — see model3d_file.py's own
# get_download for the identical reasoning.
async def get_download(db: AsyncSession, capture_id: uuid.UUID) -> RedirectResponse:
    row = await db.get(SiteCapture, capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Site capture not found")
    url = await run_in_threadpool(object_storage.presigned_get_url, row.storage_filename)
    return RedirectResponse(url)


async def delete_capture(db: AsyncSession, capture_id: uuid.UUID) -> None:
    row = await db.get(SiteCapture, capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Site capture not found")
    await run_in_threadpool(object_storage.delete_object, row.storage_filename)
    await db.delete(row)
    await db.commit()


# Converts an uploaded raw .e57's stored bytes into a plain .xyz file
# (2026-08-20, per Maro's own 14.4GB real export — see e57_convert.py's own
# header for the full "why server-side, why now" story).
#
# Downloads to a local temp file first, now that the source lives in R2,
# not local disk (2026-08-23) — pye57's own C++ bindings need a real local
# path, there's no in-memory/streaming variant. run_in_threadpool for both
# the R2 download and the conversion itself — both are real, potentially
# minutes-long blocking I/O/CPU work for a large export, and calling either
# directly here would freeze this whole server's event loop (every other
# request on it) for that entire time, not just this one's own connection,
# same reasoning this function already had for the conversion step alone
# before this change.
async def convert_capture(db: AsyncSession, capture_id: uuid.UUID) -> SiteCaptureResponse:
    row = await db.get(SiteCapture, capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Site capture not found")
    if row.kind != "e57":
        raise HTTPException(status_code=400, detail="This capture is not a raw .e57 upload — nothing to convert")

    with tempfile.TemporaryDirectory() as tmp_dir:
        e57_path = Path(tmp_dir) / "capture.e57"
        try:
            await run_in_threadpool(object_storage.download_to_path, row.storage_filename, e57_path)
        except Exception:
            raise HTTPException(status_code=404, detail="Stored file is missing in storage") from None

        xyz_path = Path(tmp_dir) / "capture.xyz"
        try:
            await run_in_threadpool(convert_e57_to_xyz, e57_path, xyz_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to convert E57 file: {exc}") from None

        xyz_storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, f"{row.name.rsplit('.', 1)[0]}.xyz")
        await run_in_threadpool(object_storage.upload_from_path, xyz_storage_key, xyz_path)
        xyz_size = xyz_path.stat().st_size

    old_storage_key = row.storage_filename
    row.storage_filename = xyz_storage_key
    row.kind = "xyz"
    row.size_bytes = xyz_size
    await db.commit()
    await db.refresh(row)
    await run_in_threadpool(object_storage.delete_object, old_storage_key)
    return SiteCaptureResponse.model_validate(row)


# "Generate IFC" (2026-08-20, per Maro: "pointcloud to ifc" / "build") —
# runs the vendored Cloud2BIM pipeline (cloud2bim_convert.py) against this
# capture's own stored .xyz and registers the result as a normal
# Model3DFile (kind='ifc'). Downloads to a local temp file first (2026-08-23
# — same R2-not-local-disk reasoning as convert_capture above); Cloud2BIM's
# own subprocess-based pipeline needs real local paths in and out.
async def generate_ifc(db: AsyncSession, capture_id: uuid.UUID) -> Model3DFileResponse:
    row = await db.get(SiteCapture, capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Site capture not found")
    if row.kind != "xyz":
        raise HTTPException(
            status_code=400,
            detail="Convert this capture to XYZ first — IFC generation needs the precision point cloud, not a raw .e57",
        )

    project = await db.get(Project, row.project_id)
    project_name = project.name if project is not None else "Project"

    with tempfile.TemporaryDirectory() as tmp_dir:
        xyz_path = Path(tmp_dir) / "capture.xyz"
        try:
            await run_in_threadpool(object_storage.download_to_path, row.storage_filename, xyz_path)
        except Exception:
            raise HTTPException(status_code=404, detail="Stored file is missing in storage") from None

        try:
            ifc_bytes = await run_in_threadpool(generate_ifc_from_xyz, xyz_path, project_name, row.name)
        except Cloud2BimError as exc:
            raise HTTPException(status_code=500, detail=f"Failed to generate IFC: {exc}") from None

        ifc_path = Path(tmp_dir) / "result.ifc"
        ifc_path.write_bytes(ifc_bytes)
        ifc_name = f"{row.name.rsplit('.', 1)[0]} (Generated IFC).ifc"
        return await create_file_from_path(db, row.project_id, ifc_name, "ifc", "z", ifc_path)
