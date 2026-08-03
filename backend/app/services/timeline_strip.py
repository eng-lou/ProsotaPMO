from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.timeline_strip import TimelineStrip
from app.schemas.timeline_strip import TimelineStripResponse, TimelineStripUpsert


async def get_or_default(db: AsyncSession, project_id: uuid.UUID) -> TimelineStripResponse:
    row = (await db.execute(select(TimelineStrip).where(TimelineStrip.project_id == project_id))).scalar_one_or_none()
    if row is not None:
        return TimelineStripResponse.model_validate(row)
    defaults = TimelineStripUpsert(project_id=project_id)
    return TimelineStripResponse(project_id=project_id, **defaults.model_dump(exclude={"project_id"}))


async def upsert(db: AsyncSession, data: TimelineStripUpsert) -> TimelineStripResponse:
    row = (await db.execute(select(TimelineStrip).where(TimelineStrip.project_id == data.project_id))).scalar_one_or_none()
    if row is None:
        row = TimelineStrip(project_id=data.project_id)
        db.add(row)
    for field, value in data.model_dump(exclude={"project_id"}).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return TimelineStripResponse.model_validate(row)
