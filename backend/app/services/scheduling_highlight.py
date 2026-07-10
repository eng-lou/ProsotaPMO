from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduling_highlight import SchedulingHighlight
from app.schemas.scheduling_highlight import SchedulingHighlightCreate, SchedulingHighlightResponse, SchedulingHighlightUpdate


async def create_highlight(db: AsyncSession, data: SchedulingHighlightCreate) -> SchedulingHighlightResponse:
    row = SchedulingHighlight(
        project_id=data.project_id,
        name=data.name,
        match_mode=data.match_mode,
        conditions=[c.model_dump() for c in data.conditions],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return SchedulingHighlightResponse.model_validate(row)


async def list_highlights(db: AsyncSession, project_id: uuid.UUID) -> list[SchedulingHighlightResponse]:
    rows = (await db.execute(
        select(SchedulingHighlight).where(SchedulingHighlight.project_id == project_id).order_by(SchedulingHighlight.created_at.desc())
    )).scalars().all()
    return [SchedulingHighlightResponse.model_validate(r) for r in rows]


async def update_highlight(db: AsyncSession, highlight_id: uuid.UUID, data: SchedulingHighlightUpdate) -> SchedulingHighlightResponse:
    row = (await db.execute(select(SchedulingHighlight).where(SchedulingHighlight.id == highlight_id))).scalar_one()
    row.name = data.name
    row.match_mode = data.match_mode
    row.conditions = [c.model_dump() for c in data.conditions]
    await db.commit()
    await db.refresh(row)
    return SchedulingHighlightResponse.model_validate(row)


async def delete_highlight(db: AsyncSession, highlight_id: uuid.UUID) -> None:
    row = (await db.execute(select(SchedulingHighlight).where(SchedulingHighlight.id == highlight_id))).scalar_one()
    await db.delete(row)
    await db.commit()
