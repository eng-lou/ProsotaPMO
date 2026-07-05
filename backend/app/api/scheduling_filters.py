from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.scheduling_filter import SchedulingFilterCreate, SchedulingFilterResponse, SchedulingFilterUpdate
from app.services import scheduling_filter as svc

router = APIRouter(prefix="/scheduling-filters", tags=["scheduling-filters"])


@router.get("/", response_model=list[SchedulingFilterResponse])
async def list_filters(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_filters(db, project_id)


@router.post("/", response_model=SchedulingFilterResponse, status_code=201)
async def create_filter(
    data: SchedulingFilterCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_filter(db, data)


@router.patch("/{filter_id}", response_model=SchedulingFilterResponse)
async def update_filter(
    filter_id: uuid.UUID,
    data: SchedulingFilterUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_filter(db, filter_id, data)


@router.delete("/{filter_id}", status_code=204)
async def delete_filter(
    filter_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_filter(db, filter_id)
    return Response(status_code=204)
