from __future__ import annotations

import uuid

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.material_preset import MaterialPreset
from app.models.material_preset_texture import MaterialPresetTexture
from app.schemas.material_preset import MaterialPresetResponse, MaterialPresetSlot, MaterialPresetTextureUpload
from app.schemas.model3d_file import PresignedUpload
from app.services import object_storage

STORAGE_PREFIX = "material-presets"


def presign_upload(name: str, content_type: str) -> PresignedUpload:
    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, name)
    upload_url = object_storage.presigned_put_url(storage_key, content_type)
    return PresignedUpload(storage_key=storage_key, upload_url=upload_url)


# A replaced texture gets a brand-new row (new id), not an in-place update
# (2026-09-30): the frontend caches texture bytes locally by texture id, so
# an id must never point at different bytes over its lifetime.
async def _replace_slot(
    db: AsyncSession, preset_id: uuid.UUID, slot: MaterialPresetSlot, upload: MaterialPresetTextureUpload,
) -> None:
    # Only keys this feature's own /presign handed out — stops a crafted
    # request from attaching some other feature's stored object.
    if not upload.storage_key.startswith(f"{STORAGE_PREFIX}/"):
        raise HTTPException(status_code=400, detail="Invalid texture storage key")
    try:
        size = await run_in_threadpool(object_storage.head_object_size, upload.storage_key)
    except Exception:
        raise HTTPException(
            status_code=400, detail="Uploaded texture not found in storage — the upload may have failed or expired",
        ) from None
    await _clear_slot(db, preset_id, slot)
    db.add(MaterialPresetTexture(
        preset_id=preset_id, slot=slot, name=upload.name or slot,
        storage_filename=upload.storage_key, size_bytes=size,
    ))


async def _clear_slot(db: AsyncSession, preset_id: uuid.UUID, slot: MaterialPresetSlot) -> None:
    existing = (await db.execute(
        select(MaterialPresetTexture).where(MaterialPresetTexture.preset_id == preset_id, MaterialPresetTexture.slot == slot)
    )).scalar_one_or_none()
    if existing is not None:
        await run_in_threadpool(object_storage.delete_object, existing.storage_filename)
        await db.delete(existing)
        await db.flush()  # before a replacement row for the same slot is added


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
    db: AsyncSession, project_id: uuid.UUID, name: str,
    slot_files: dict[MaterialPresetSlot, MaterialPresetTextureUpload],
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
    slot_files: dict[MaterialPresetSlot, MaterialPresetTextureUpload], cleared_slots: list[MaterialPresetSlot],
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
# a 307 transparently.
async def get_texture_download(db: AsyncSession, preset_id: uuid.UUID, slot: MaterialPresetSlot) -> RedirectResponse:
    row = (await db.execute(
        select(MaterialPresetTexture).where(MaterialPresetTexture.preset_id == preset_id, MaterialPresetTexture.slot == slot)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="This preset has no texture in that slot")
    url = await run_in_threadpool(object_storage.presigned_get_url, row.storage_filename)
    return RedirectResponse(url)
