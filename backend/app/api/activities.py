from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.activity import ActivityCreate, ActivityResponse, ActivityUpdate
from app.services import activity as svc

router = APIRouter(prefix="/activities", tags=["activities"])


@router.get("/", response_model=list[ActivityResponse])
async def list_activities(
    project_id: uuid.UUID,
    period_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_activities(db, project_id, period_id)


@router.post("/", response_model=ActivityResponse, status_code=201)
async def create_activity(
    data: ActivityCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_activity(db, data)


@router.get("/{activity_id}", response_model=ActivityResponse)
async def get_activity(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.get_activity(db, activity_id)


@router.patch("/{activity_id}", response_model=ActivityResponse)
async def update_activity(
    activity_id: uuid.UUID,
    data: ActivityUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_activity(db, activity_id, data)


@router.delete("/{activity_id}", status_code=204)
async def delete_activity(
    activity_id: uuid.UUID,
    cascade: bool = True,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """cascade=false promotes direct children to the deleted activity's own parent
    (they end up "level with" its former siblings) instead of deleting them too."""
    await svc.delete_activity(db, activity_id, cascade=cascade)
    return Response(status_code=204)
