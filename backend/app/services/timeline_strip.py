from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.timeline_strip import TimelineStrip
from app.schemas.timeline_strip import TimelineStripCreate, TimelineStripResponse, TimelineStripUpdate


async def list_timeline_strips(db: AsyncSession, project_id: uuid.UUID) -> list[TimelineStripResponse]:
    rows = (await db.execute(
        select(TimelineStrip).where(TimelineStrip.project_id == project_id).order_by(TimelineStrip.created_at)
    )).scalars().all()
    return [TimelineStripResponse.model_validate(r) for r in rows]


async def create_timeline_strip(db: AsyncSession, data: TimelineStripCreate) -> TimelineStripResponse:
    row = TimelineStrip(**data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return TimelineStripResponse.model_validate(row)


async def update_timeline_strip(db: AsyncSession, strip_id: uuid.UUID, data: TimelineStripUpdate) -> TimelineStripResponse:
    row = await db.get(TimelineStrip, strip_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Timeline strip not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return TimelineStripResponse.model_validate(row)


async def delete_timeline_strip(db: AsyncSession, strip_id: uuid.UUID) -> None:
    row = await db.get(TimelineStrip, strip_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Timeline strip not found")
    await db.delete(row)
    await db.commit()
