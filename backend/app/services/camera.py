from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.camera import Camera
from app.models.element_keyframe import ElementKeyframe
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
    # A camera's keyframes live in element_keyframes (source_kind="camera",
    # element_ref=str(camera.id)) with no foreign key to cascade from, so
    # deleting the camera used to leave its whole keyframe track orphaned in
    # the Animation Timeline (2026-10-02, per Maro: "even deleting the camera
    # i still see the keyframe"). Delete them in the same transaction.
    await db.execute(
        delete(ElementKeyframe).where(
            ElementKeyframe.project_id == row.project_id,
            ElementKeyframe.source_kind == "camera",
            ElementKeyframe.element_ref == str(camera_id),
        )
    )
    await db.delete(row)
    await db.commit()
