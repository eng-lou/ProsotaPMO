from __future__ import annotations

import tempfile
import uuid
from datetime import date
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.site_capture import SiteCapture
from app.schemas.model3d_file import Model3DFileResponse
from app.schemas.site_capture import SiteCaptureKind, SiteCaptureResponse, SiteCaptureUpdate, UpAxis
from app.services.cloud2bim_convert import Cloud2BimError, generate_ifc_from_xyz
from app.services.e57_convert import convert_e57_to_xyz
from app.services.model3d_file import create_file_from_path
from app.services.site_capture_storage import delete_stored_file, generate_storage_filename, storage_path

# A real raw .e57 export (2026-08-20, per Maro's own file: a 14.4GB
# `cloud_0.e57` — a single MatterPak's own cloud.xyz, by contrast, runs
# ~500MB) can be an order of magnitude larger than the .xyz case
# model3d_file.py's own 1GB cap was sized for. 20GB is real headroom for
# that, not an arbitrary round number — see e57_convert.py's own header
# for why the E57->XYZ conversion this file's upload triggers happens
# here, server-side, rather than in the browser.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024


async def list_captures(db: AsyncSession, project_id: uuid.UUID) -> list[SiteCaptureResponse]:
    rows = (await db.execute(
        select(SiteCapture).where(SiteCapture.project_id == project_id).order_by(SiteCapture.captured_at)
    )).scalars().all()
    return [SiteCaptureResponse.model_validate(r) for r in rows]


async def create_capture(
    db: AsyncSession, project_id: uuid.UUID, name: str, captured_at: date,
    kind: SiteCaptureKind, source_up_axis: UpAxis, upload: UploadFile,
) -> SiteCaptureResponse:
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

    row = SiteCapture(
        project_id=project_id, name=name, captured_at=captured_at, kind=kind, source_up_axis=source_up_axis,
        storage_filename=storage_filename, size_bytes=size,
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


async def get_download(db: AsyncSession, capture_id: uuid.UUID) -> FileResponse:
    row = await db.get(SiteCapture, capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Site capture not found")
    path = storage_path(row.storage_filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored file is missing on disk")
    return FileResponse(path, filename=row.name, media_type="application/octet-stream")


async def delete_capture(db: AsyncSession, capture_id: uuid.UUID) -> None:
    row = await db.get(SiteCapture, capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Site capture not found")
    delete_stored_file(row.storage_filename)
    await db.delete(row)
    await db.commit()


# Converts an uploaded raw .e57's stored bytes into a plain .xyz file in
# place (2026-08-20, per Maro's own 14.4GB real export — see
# e57_convert.py's own header for the full "why server-side, why now"
# story). run_in_threadpool, not a plain await, because pye57/numpy are
# both synchronous CPU/IO-bound calls — for a real multi-hundred-million-
# point file this can run for minutes, and calling it directly inside this
# async endpoint would freeze the whole event loop (every other request on
# this server) for that entire time, not just this one's own connection.
#
# The original .e57 is deleted once the .xyz is written successfully — a
# 14GB+ source file plus a comparable-or-larger converted output would
# otherwise roughly double the disk cost of every large capture for no
# ongoing benefit (once converted, nothing downstream ever reads the raw
# .e57 again — see progressVarianceEngine.ts's own kind='xyz'-only load
# path). kind flips to 'xyz' so this becomes a normal, already-supported
# capture from every other consumer's point of view — no special-casing
# needed anywhere else once this has run once.
async def convert_capture(db: AsyncSession, capture_id: uuid.UUID) -> SiteCaptureResponse:
    row = await db.get(SiteCapture, capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Site capture not found")
    if row.kind != "e57":
        raise HTTPException(status_code=400, detail="This capture is not a raw .e57 upload — nothing to convert")

    e57_path = storage_path(row.storage_filename)
    if not e57_path.exists():
        raise HTTPException(status_code=404, detail="Stored file is missing on disk")

    xyz_storage_filename = generate_storage_filename(f"{row.name.rsplit('.', 1)[0]}.xyz")
    xyz_path = storage_path(xyz_storage_filename)
    try:
        await run_in_threadpool(convert_e57_to_xyz, e57_path, xyz_path)
    except Exception as exc:
        xyz_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to convert E57 file: {exc}") from None

    old_storage_filename = row.storage_filename
    row.storage_filename = xyz_storage_filename
    row.kind = "xyz"
    row.size_bytes = xyz_path.stat().st_size
    await db.commit()
    await db.refresh(row)
    delete_stored_file(old_storage_filename)
    return SiteCaptureResponse.model_validate(row)


# "Generate IFC" (2026-08-20, per Maro: "pointcloud to ifc" / "build") —
# runs the vendored Cloud2BIM pipeline (cloud2bim_convert.py) against this
# capture's own stored .xyz and registers the result as a normal
# Model3DFile (kind='ifc'), so it loads through this app's existing IFC
# import/viewer pipeline exactly like any other IFC — no new frontend
# rendering path needed. Only ever runs against kind='xyz' (the precision
# point cloud Cloud2BIM's own wall/slab segmentation needs) — a raw
# kind='e57' capture has to go through its own "Convert" step first (same
# xyz-only restriction progress_variance_test.py's own site_capture_id
# already has, for the identical underlying reason). run_in_threadpool for
# the same reason convert_capture above uses it — this is real,
# synchronous CPU-bound work (numpy/opencv/scikit-image), and a real
# multi-storey conversion can run for minutes.
async def generate_ifc(db: AsyncSession, capture_id: uuid.UUID) -> Model3DFileResponse:
    row = await db.get(SiteCapture, capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Site capture not found")
    if row.kind != "xyz":
        raise HTTPException(
            status_code=400,
            detail="Convert this capture to XYZ first — IFC generation needs the precision point cloud, not a raw .e57",
        )

    xyz_path = storage_path(row.storage_filename)
    if not xyz_path.exists():
        raise HTTPException(status_code=404, detail="Stored file is missing on disk")

    project = await db.get(Project, row.project_id)
    project_name = project.name if project is not None else "Project"

    try:
        ifc_bytes = await run_in_threadpool(generate_ifc_from_xyz, xyz_path, project_name, row.name)
    except Cloud2BimError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate IFC: {exc}") from None

    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        tmp.write(ifc_bytes)
        tmp_path = Path(tmp.name)
    try:
        ifc_name = f"{row.name.rsplit('.', 1)[0]} (Generated IFC).ifc"
        return await create_file_from_path(db, row.project_id, ifc_name, "ifc", "z", tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)
