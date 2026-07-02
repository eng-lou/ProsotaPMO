from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.period import Period
from app.schemas.activity import ActivityCreate, ActivityUpdate
from app.services.reference_codes import next_code


async def _require_live_period(db: AsyncSession, period_id: uuid.UUID) -> None:
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    if period.freeze_status != "live":
        raise HTTPException(
            status_code=422,
            detail=f"Period '{period.period_label}' is {period.freeze_status}. Writes to frozen periods are not allowed.",
        )


async def list_activities(
    db: AsyncSession,
    project_id: uuid.UUID,
    period_id: uuid.UUID | None = None,
) -> list[Activity]:
    q = select(Activity).where(Activity.project_id == project_id)
    if period_id is not None:
        q = q.where(Activity.period_id == period_id)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_activity(db: AsyncSession, activity_id: uuid.UUID) -> Activity:
    activity = await db.get(Activity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


def _apply_computed_fields(activity: Activity) -> None:
    """Recompute the fields that are never accepted directly from clients.

    Per PMBOK7 / Rita Mulcahy Ch. 8 ("Schedule"): variance is finish vs. the
    captured baseline finish — meaningless (and left null) until a baseline
    actually exists. total_float/is_critical are outputs of the Critical Path
    Method's forward/backward pass, not opinions a user types in — same class
    of bug already fixed for Risk's EMV and Cost's CPI/SPI. Until Phase 5's
    CPM engine exists (docs/SCHEDULING_MODULE_PLAN.md), they stay honestly
    null rather than holding a fake or stale value.
    """
    activity.variance_days = (
        (activity.finish - activity.bl_finish).days
        if activity.finish is not None and activity.bl_finish is not None
        else None
    )
    activity.total_float = None
    activity.is_critical = None


async def create_activity(db: AsyncSession, data: ActivityCreate) -> Activity:
    await _require_live_period(db, data.period_id)
    code = await next_code(db, Activity, "ACT", data.project_id)
    activity = Activity(**data.model_dump(), code=code)
    _apply_computed_fields(activity)
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


async def update_activity(
    db: AsyncSession, activity_id: uuid.UUID, data: ActivityUpdate
) -> Activity:
    activity = await get_activity(db, activity_id)
    await _require_live_period(db, activity.period_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(activity, field, value)
    _apply_computed_fields(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


async def delete_activity(db: AsyncSession, activity_id: uuid.UUID) -> None:
    activity = await get_activity(db, activity_id)
    await _require_live_period(db, activity.period_id)
    await db.delete(activity)
    await db.commit()
