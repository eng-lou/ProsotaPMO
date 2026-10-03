from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.timeline_strip import TimelineStripCreate, TimelineStripResponse, TimelineStripUpdate
from app.services import timeline_strip as svc

router = APIRouter(prefix="/timeline-strips", tags=["timeline-strips"])


@router.get("/", response_model=list[TimelineStripResponse])
async def list_timeline_strips(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_timeline_strips(db, project_id)


@router.post("/", response_model=TimelineStripResponse, status_code=201)
async def create_timeline_strip(
    data: TimelineStripCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_timeline_strip(db, data)


@router.patch("/{strip_id}", response_model=TimelineStripResponse)
async def update_timeline_strip(
    strip_id: uuid.UUID,
    data: TimelineStripUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_timeline_strip(db, strip_id, data)


@router.delete("/{strip_id}", status_code=204)
async def delete_timeline_strip(
    strip_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_timeline_strip(db, strip_id)
    return Response(status_code=204)
