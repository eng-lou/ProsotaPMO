from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduling_filter import SchedulingFilter
from app.schemas.scheduling_filter import SchedulingFilterCreate, SchedulingFilterResponse, SchedulingFilterUpdate


async def create_filter(db: AsyncSession, data: SchedulingFilterCreate) -> SchedulingFilterResponse:
    row = SchedulingFilter(
        project_id=data.project_id,
        name=data.name,
        match_mode=data.match_mode,
        conditions=[c.model_dump() for c in data.conditions],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return SchedulingFilterResponse.model_validate(row)


async def list_filters(db: AsyncSession, project_id: uuid.UUID) -> list[SchedulingFilterResponse]:
    rows = (await db.execute(
        select(SchedulingFilter).where(SchedulingFilter.project_id == project_id).order_by(SchedulingFilter.created_at.desc())
    )).scalars().all()
    return [SchedulingFilterResponse.model_validate(r) for r in rows]


async def update_filter(db: AsyncSession, filter_id: uuid.UUID, data: SchedulingFilterUpdate) -> SchedulingFilterResponse:
    row = (await db.execute(select(SchedulingFilter).where(SchedulingFilter.id == filter_id))).scalar_one()
    row.name = data.name
    row.match_mode = data.match_mode
    row.conditions = [c.model_dump() for c in data.conditions]
    await db.commit()
    await db.refresh(row)
    return SchedulingFilterResponse.model_validate(row)


async def delete_filter(db: AsyncSession, filter_id: uuid.UUID) -> None:
    row = (await db.execute(select(SchedulingFilter).where(SchedulingFilter.id == filter_id))).scalar_one()
    await db.delete(row)
    await db.commit()
