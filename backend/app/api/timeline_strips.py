from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.timeline_strip import TimelineStripResponse, TimelineStripUpsert
from app.services import timeline_strip as svc

router = APIRouter(prefix="/timeline-strips", tags=["timeline-strips"])


@router.get("/", response_model=TimelineStripResponse)
async def get_timeline_strip(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """The one, project-wide timeline strip. Returns an in-memory default
    (never a 404) if nothing has been saved yet, same convention as
    GET /letterhead/."""
    return await svc.get_or_default(db, project_id)


@router.put("/", response_model=TimelineStripResponse)
async def save_timeline_strip(
    data: TimelineStripUpsert,
    db: AsyncSession = Depends(get_db),
):
    return await svc.upsert(db, data)
