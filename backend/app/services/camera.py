from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.camera import Camera
from app.schemas.camera import CameraCreate, CameraResponse, CameraUpdate


async def list_cameras(db: AsyncSession, project_id: uuid.UUID) -> list[CameraResponse]:
    rows = (await db.execute(
        select(Camera).where(Camera.project_id == project_id).order_by(Camera.created_at)
    )).scalars().all()
    return [CameraResponse.model_validate(r) for r in rows]


async def create_camera(db: AsyncSession, data: CameraCreate) -> CameraResponse:
    row = Camera(**data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return CameraResponse.model_validate(row)


async def update_camera(db: AsyncSession, camera_id: uuid.UUID, data: CameraUpdate) -> CameraResponse:
    row = await db.get(Camera, camera_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return CameraResponse.model_validate(row)


async def delete_camera(db: AsyncSession, camera_id: uuid.UUID) -> None:
    row = await db.get(Camera, camera_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    await db.delete(row)
    await db.commit()
