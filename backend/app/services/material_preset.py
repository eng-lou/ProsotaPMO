from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.material_preset import MaterialPreset
from app.models.material_preset_texture import MaterialPresetTexture
from app.schemas.material_preset import MaterialPresetResponse, MaterialPresetSlot
from app.services.model3d_storage import delete_stored_file, generate_storage_filename, storage_path

# Same defensive cap/chunk size as model3d_file.py's own create_file —
# reused verbatim, not re-tuned, for the identical reason: no CDN/chunked
# upload infrastructure, just a straight stream to local disk.
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024


async def _write_upload_to_disk(name: str, upload: UploadFile) -> tuple[str, int]:
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
        raise HTTPException(status_code=500, detail="Failed to save uploaded texture")
    return storage_filename, size


async def _replace_slot(db: AsyncSession, preset_id: uuid.UUID, slot: MaterialPresetSlot, upload: UploadFile) -> None:
    existing = (await db.execute(
        select(MaterialPresetTexture).where(MaterialPresetTexture.preset_id == preset_id, MaterialPresetTexture.slot == slot)
    )).scalar_one_or_none()
    storage_filename, size = await _write_upload_to_disk(upload.filename or slot, upload)
    if existing is not None:
        delete_stored_file(existing.storage_filename)
        existing.name = upload.filename or slot
        existing.storage_filename = storage_filename
        existing.size_bytes = size
    else:
        db.add(MaterialPresetTexture(
            preset_id=preset_id, slot=slot, name=upload.filename or slot,
            storage_filename=storage_filename, size_bytes=size,
        ))


async def _clear_slot(db: AsyncSession, preset_id: uuid.UUID, slot: MaterialPresetSlot) -> None:
    existing = (await db.execute(
        select(MaterialPresetTexture).where(MaterialPresetTexture.preset_id == preset_id, MaterialPresetTexture.slot == slot)
    )).scalar_one_or_none()
    if existing is not None:
        delete_stored_file(existing.storage_filename)
        await db.delete(existing)


async def _to_response(db: AsyncSession, row: MaterialPreset) -> MaterialPresetResponse:
    textures = (await db.execute(
        select(MaterialPresetTexture).where(MaterialPresetTexture.preset_id == row.id).order_by(MaterialPresetTexture.slot)
    )).scalars().all()
    return MaterialPresetResponse(
        id=row.id, project_id=row.project_id, name=row.name, created_at=row.created_at, updated_at=row.updated_at,
        textures=[{"id": t.id, "slot": t.slot, "name": t.name} for t in textures],
    )


async def list_presets(db: AsyncSession, project_id: uuid.UUID) -> list[MaterialPresetResponse]:
    rows = (await db.execute(
        select(MaterialPreset).where(MaterialPreset.project_id == project_id).order_by(MaterialPreset.created_at)
    )).scalars().all()
    return [await _to_response(db, r) for r in rows]


async def create_preset(
    db: AsyncSession, project_id: uuid.UUID, name: str, slot_files: dict[MaterialPresetSlot, UploadFile],
) -> MaterialPresetResponse:
    row = MaterialPreset(project_id=project_id, name=name)
    db.add(row)
    await db.flush()  # assigns row.id, needed to attach texture rows below
    for slot, upload in slot_files.items():
        await _replace_slot(db, row.id, slot, upload)
    await db.commit()
    await db.refresh(row)
    return await _to_response(db, row)


async def update_preset(
    db: AsyncSession, preset_id: uuid.UUID, name: str,
    slot_files: dict[MaterialPresetSlot, UploadFile], cleared_slots: list[MaterialPresetSlot],
) -> MaterialPresetResponse:
    row = await db.get(MaterialPreset, preset_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Material preset not found")
    row.name = name
    for slot, upload in slot_files.items():
        await _replace_slot(db, preset_id, slot, upload)
    for slot in cleared_slots:
        if slot not in slot_files:  # a fresh upload for a slot already wins over also clearing it
            await _clear_slot(db, preset_id, slot)
    await db.commit()
    await db.refresh(row)
    return await _to_response(db, row)


async def delete_preset(db: AsyncSession, preset_id: uuid.UUID) -> None:
    row = await db.get(MaterialPreset, preset_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Material preset not found")
    textures = (await db.execute(
        select(MaterialPresetTexture).where(MaterialPresetTexture.preset_id == preset_id)
    )).scalars().all()
    for t in textures:
        delete_stored_file(t.storage_filename)
    await db.delete(row)  # cascades the MaterialPresetTexture rows themselves
    await db.commit()


async def get_texture_download(db: AsyncSession, preset_id: uuid.UUID, slot: MaterialPresetSlot) -> FileResponse:
    row = (await db.execute(
        select(MaterialPresetTexture).where(MaterialPresetTexture.preset_id == preset_id, MaterialPresetTexture.slot == slot)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="This preset has no texture in that slot")
    path: Path = storage_path(row.storage_filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored texture is missing on disk")
    return FileResponse(path, filename=row.name, media_type="application/octet-stream")
