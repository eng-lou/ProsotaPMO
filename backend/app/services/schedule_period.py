from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schedule_period import SchedulePeriod
from app.schemas.schedule_period import SchedulePeriodCreate, SchedulePeriodUpdate


async def list_periods(db: AsyncSession, schedule_variant_id: uuid.UUID) -> list[SchedulePeriod]:
    result = await db.execute(
        select(SchedulePeriod)
        .where(SchedulePeriod.schedule_variant_id == schedule_variant_id)
        .order_by(SchedulePeriod.created_at)
    )
    return list(result.scalars().all())


async def create_period(db: AsyncSession, data: SchedulePeriodCreate) -> SchedulePeriod:
    period = SchedulePeriod(**data.model_dump())
    db.add(period)
    await db.commit()
    await db.refresh(period)
    return period


async def get_period(db: AsyncSession, period_id: uuid.UUID) -> SchedulePeriod:
    period = await db.get(SchedulePeriod, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Schedule period not found")
    return period


async def update_period(db: AsyncSession, period_id: uuid.UUID, data: SchedulePeriodUpdate) -> SchedulePeriod:
    period = await get_period(db, period_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(period, field, value)
    await db.commit()
    await db.refresh(period)
    return period


async def delete_period(db: AsyncSession, period_id: uuid.UUID) -> None:
    period = await get_period(db, period_id)
    await db.delete(period)
    await db.commit()


# Same atomic find-or-create shape as app/api/periods.py:bootstrap_period —
# same real race this guards against (two concurrent "first ever activity"
# requests for a brand-new variant both seeing an empty list and both trying
# to create "Period 1"), same fix (rely on the DB's own partial unique index
# as the actual race guard, not a client-side check-then-create).
async def bootstrap_period(db: AsyncSession, schedule_variant_id: uuid.UUID) -> SchedulePeriod:
    result = await db.execute(
        select(SchedulePeriod)
        .where(SchedulePeriod.schedule_variant_id == schedule_variant_id)
        .order_by(SchedulePeriod.created_at)
    )
    periods = list(result.scalars().all())
    active = next((p for p in periods if p.freeze_status == "live"), None) or (periods[0] if periods else None)
    if active is not None:
        return active

    period = SchedulePeriod(schedule_variant_id=schedule_variant_id, period_label="Period 1", freeze_status="live")
    db.add(period)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        result = await db.execute(
            select(SchedulePeriod).where(
                SchedulePeriod.schedule_variant_id == schedule_variant_id, SchedulePeriod.freeze_status == "live"
            )
        )
        return result.scalar_one()
    await db.refresh(period)
    return period
