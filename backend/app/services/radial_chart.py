from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.radial_chart import RadialChart
from app.schemas.radial_chart import RadialChartCreate, RadialChartResponse, RadialChartUpdate
from app.services.model3d_storage import delete_stored_file, generate_storage_filename, storage_path

# Same defensive cap/chunk size as material_preset.py's own upload path — an
# icon is a small PNG, not a texture, but there's no reason to duplicate a
# smaller constant just for that; the real ceiling that matters in practice
# is CHUNK_SIZE-at-a-time streaming to disk, not this number.
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024


async def list_radial_charts(db: AsyncSession, project_id: uuid.UUID) -> list[RadialChartResponse]:
    rows = (await db.execute(
        select(RadialChart).where(RadialChart.project_id == project_id).order_by(RadialChart.created_at)
    )).scalars().all()
    return [RadialChartResponse.model_validate(r) for r in rows]


async def create_radial_chart(db: AsyncSession, data: RadialChartCreate) -> RadialChartResponse:
    row = RadialChart(**data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return RadialChartResponse.model_validate(row)


async def update_radial_chart(db: AsyncSession, chart_id: uuid.UUID, data: RadialChartUpdate) -> RadialChartResponse:
    row = await db.get(RadialChart, chart_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Radial chart not found")
    changes = data.model_dump(exclude_unset=True)
    # Switching away from "icon" leaves an orphaned upload on disk with
    # nothing left pointing at it — same "clear the stored file the moment
    # it stops being referenced" reasoning material_preset.py's own
    # _clear_slot already applies per-slot.
    if changes.get("center_mode") not in (None, "icon") and row.icon_storage_filename:
        delete_stored_file(row.icon_storage_filename)
        row.icon_storage_filename = None
    for field, value in changes.items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return RadialChartResponse.model_validate(row)


async def delete_radial_chart(db: AsyncSession, chart_id: uuid.UUID) -> None:
    row = await db.get(RadialChart, chart_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Radial chart not found")
    if row.icon_storage_filename:
        delete_stored_file(row.icon_storage_filename)
    await db.delete(row)
    await db.commit()


async def upload_icon(db: AsyncSession, chart_id: uuid.UUID, upload: UploadFile) -> RadialChartResponse:
    row = await db.get(RadialChart, chart_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Radial chart not found")
    storage_filename = generate_storage_filename(upload.filename or "icon.png")
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
        raise HTTPException(status_code=500, detail="Failed to save uploaded icon")
    if row.icon_storage_filename:
        delete_stored_file(row.icon_storage_filename)
    row.icon_storage_filename = storage_filename
    row.center_mode = "icon"
    await db.commit()
    await db.refresh(row)
    return RadialChartResponse.model_validate(row)


async def get_icon_download(db: AsyncSession, chart_id: uuid.UUID) -> FileResponse:
    row = await db.get(RadialChart, chart_id)
    if row is None or not row.icon_storage_filename:
        raise HTTPException(status_code=404, detail="This chart has no icon")
    path: Path = storage_path(row.icon_storage_filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored icon is missing on disk")
    return FileResponse(path, filename=row.icon_storage_filename, media_type="image/png")
