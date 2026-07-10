from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.camera_view import CameraViewCreate, CameraViewResponse, CameraViewUpdate
from app.services import camera_view as svc

router = APIRouter(prefix="/camera-views", tags=["camera-views"])


@router.get("/", response_model=list[CameraViewResponse])
async def list_camera_views(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_camera_views(db, project_id)


@router.post("/", response_model=CameraViewResponse, status_code=201)
async def create_camera_view(
    data: CameraViewCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_camera_view(db, data)


@router.patch("/{view_id}", response_model=CameraViewResponse)
async def update_camera_view(
    view_id: uuid.UUID,
    data: CameraViewUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_camera_view(db, view_id, data)


@router.delete("/{view_id}", status_code=204)
async def delete_camera_view(
    view_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_camera_view(db, view_id)
    return Response(status_code=204)
