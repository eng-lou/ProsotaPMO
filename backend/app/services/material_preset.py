from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.material_preset import MaterialPreset
from app.schemas.material_preset import MaterialPresetCreate, MaterialPresetResponse, MaterialPresetUpdate


async def list_presets(db: AsyncSession, project_id: uuid.UUID) -> list[MaterialPresetResponse]:
    rows = (await db.execute(
        select(MaterialPreset).where(MaterialPreset.project_id == project_id).order_by(MaterialPreset.created_at)
    )).scalars().all()
    return [MaterialPresetResponse.model_validate(r) for r in rows]


async def create_preset(db: AsyncSession, data: MaterialPresetCreate) -> MaterialPresetResponse:
    row = MaterialPreset(project_id=data.project_id, name=data.name, config=data.config.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return MaterialPresetResponse.model_validate(row)


async def update_preset(db: AsyncSession, preset_id: uuid.UUID, data: MaterialPresetUpdate) -> MaterialPresetResponse:
    row = await db.get(MaterialPreset, preset_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Material preset not found")
    row.name = data.name
    row.config = data.config.model_dump()
    await db.commit()
    await db.refresh(row)
    return MaterialPresetResponse.model_validate(row)


async def delete_preset(db: AsyncSession, preset_id: uuid.UUID) -> None:
    row = await db.get(MaterialPreset, preset_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Material preset not found")
    await db.delete(row)
    await db.commit()
