from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.period import Period
from app.services.activity import _require_live_period


async def set_baseline(db: AsyncSession, period_id: uuid.UUID) -> list[Activity]:
    """Snapshot every activity's current start/finish/duration_days into
    bl_start/bl_finish/bl_duration_days for this period.

    Per PMBOK7/Rita Mulcahy Ch. 8: "the approved version of the schedule model
    used to manage the project... can only be changed as a result of formally
    approved changes." Deliberately callable more than once — unlike Cost
    Plan's rev_a_baseline (set once at creation, frozen forever), a schedule
    baseline is a repeatable, deliberate capture a planner takes when a
    revision is formally agreed, not a value fixed at row creation.
    """
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    await _require_live_period(db, period_id)

    result = await db.execute(select(Activity).where(Activity.period_id == period_id))
    activities = list(result.scalars().all())
    for a in activities:
        a.bl_start = a.start
        a.bl_finish = a.finish
        a.bl_duration_days = a.duration_days
        # Same formula as app/services/activity.py:_apply_computed_fields, but that
        # helper also resets total_float/free_float/is_critical to null — appropriate
        # right before a CPM recompute, wrong here, where nothing else is re-running
        # and those values should stay exactly as the CPM engine last computed them.
        a.variance_days = (a.finish - a.bl_finish).days if a.finish is not None and a.bl_finish is not None else None

    await db.commit()
    for a in activities:
        await db.refresh(a)
    return activities
