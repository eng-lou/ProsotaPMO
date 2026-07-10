from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.camera_view import CameraView
from app.schemas.camera_view import CameraViewCreate, CameraViewResponse, CameraViewUpdate


async def list_camera_views(db: AsyncSession, project_id: uuid.UUID) -> list[CameraViewResponse]:
    rows = (await db.execute(
        select(CameraView).where(CameraView.project_id == project_id).order_by(CameraView.created_at)
    )).scalars().all()
    return [CameraViewResponse.model_validate(r) for r in rows]


async def create_camera_view(db: AsyncSession, data: CameraViewCreate) -> CameraViewResponse:
    row = CameraView(**data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return CameraViewResponse.model_validate(row)


async def update_camera_view(db: AsyncSession, view_id: uuid.UUID, data: CameraViewUpdate) -> CameraViewResponse:
    row = await db.get(CameraView, view_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Camera view not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return CameraViewResponse.model_validate(row)


async def delete_camera_view(db: AsyncSession, view_id: uuid.UUID) -> None:
    row = await db.get(CameraView, view_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Camera view not found")
    await db.delete(row)
    await db.commit()
