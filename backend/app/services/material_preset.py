from __future__ import annotations

import uuid

from fastapi import HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.material_preset import MaterialPreset
from app.models.material_preset_texture import MaterialPresetTexture
from app.schemas.material_preset import MaterialPresetResponse, MaterialPresetSlot
from app.services import object_storage

STORAGE_PREFIX = "material-presets"

# Same defensive cap/chunk size as model3d_file.py's own create_file used to
# have pre-R2 — kept here since these still arrive as a plain multipart
# upload through this backend's own request body (small PBR maps, not full
# IFC models, so no presigned-PUT step for these — see object_storage.py's
# own upload_bytes).
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024


# Uploads straight to R2 (2026-08-24 fix — the old local-disk write, still
# on model3d_storage.py's storage_path, hit Vercel's read-only filesystem in
# production: every preset save with a texture 500'd). Buffers the whole
# upload in memory first since object_storage has no streaming-PUT, which is
# fine at this size (Vercel's own 4.5MB request body cap already bounds it
# tighter than MAX_UPLOAD_BYTES ever would).
async def _write_upload_to_r2(name: str, upload: UploadFile) -> tuple[str, int]:
    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, name)
    data = bytearray()
    while chunk := await upload.read(CHUNK_SIZE):
        data.extend(chunk)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File too large")
    try:
        await run_in_threadpool(object_storage.upload_bytes, storage_key, bytes(data), upload.content_type)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save uploaded texture")
    return storage_key, len(data)


async def _replace_slot(db: AsyncSession, preset_id: uuid.UUID, slot: MaterialPresetSlot, upload: UploadFile) -> None:
    existing = (await db.execute(
        select(MaterialPresetTexture).where(MaterialPresetTexture.preset_id == preset_id, MaterialPresetTexture.slot == slot)
    )).scalar_one_or_none()
    storage_key, size = await _write_upload_to_r2(upload.filename or slot, upload)
    if existing is not None:
        await run_in_threadpool(object_storage.delete_object, existing.storage_filename)
        existing.name = upload.filename or slot
        existing.storage_filename = storage_key
        existing.size_bytes = size
    else:
        db.add(MaterialPresetTexture(
            preset_id=preset_id, slot=slot, name=upload.filename or slot,
            storage_filename=storage_key, size_bytes=size,
        ))


async def _clear_slot(db: AsyncSession, preset_id: uuid.UUID, slot: MaterialPresetSlot) -> None:
    existing = (await db.execute(
        select(MaterialPresetTexture).where(MaterialPresetTexture.preset_id == preset_id, MaterialPresetTexture.slot == slot)
    )).scalar_one_or_none()
    if existing is not None:
        await run_in_threadpool(object_storage.delete_object, existing.storage_filename)
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
        await run_in_threadpool(object_storage.delete_object, t.storage_filename)
    await db.delete(row)  # cascades the MaterialPresetTexture rows themselves
    await db.commit()


# Redirects to a presigned R2 GET url, same reasoning as model3d_file.py's
# own get_download — the frontend's axios GET (responseType: 'blob') follows
# a 307 transparently, so this needed no frontend change.
async def get_texture_download(db: AsyncSession, preset_id: uuid.UUID, slot: MaterialPresetSlot) -> RedirectResponse:
    row = (await db.execute(
        select(MaterialPresetTexture).where(MaterialPresetTexture.preset_id == preset_id, MaterialPresetTexture.slot == slot)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="This preset has no texture in that slot")
    url = await run_in_threadpool(object_storage.presigned_get_url, row.storage_filename)
    return RedirectResponse(url)
