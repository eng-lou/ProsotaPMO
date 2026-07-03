from __future__ import annotations

import uuid
from datetime import date, time, timedelta

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.services import scheduling_cpm
from app.services.activity import _require_live_period


async def reschedule(db: AsyncSession, period_id: uuid.UUID, shift_days: int) -> dict:
    """Shift the period's schedule anchor by shift_days (positive = later, negative =
    earlier) and re-run the CPM engine.

    This is the only honest lever left once Phase 5 made start/finish fully computed:
    directly moving individual activities' dates would just be overwritten by the next
    recompute, since dates are derived from duration + logic + calendar + constraints,
    not stored opinions. Per PMBOK7/Rita Mulcahy Ch.8, real schedule compression means
    changing durations or logic (crashing/fast-tracking), not moving dates directly —
    this shifts the unconstrained network's anchor; activities pinned by a hard
    SNET/MS/FNLT constraint date deliberately won't move, which is correct behaviour,
    not a bug. See docs/SCHEDULING_MODULE_PLAN.md Phase 9 for the fuller reasoning
    behind why "Apply To: critical path only / selected / WBS group" from the
    prototype's Reschedule widget aren't implemented here — none of them have an
    honest mapping onto a logic-driven schedule without deeper constraint-editing UI.

    Only moves the date — whatever time-of-day is already set (period.start_time,
    None meaning "the calendar's day start") is left alone, since shifting by a
    number of days has no opinion about time-of-day. See set_data_date below for
    the action that can change it.
    """
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    await _require_live_period(db, period_id)

    old_finish = await scheduling_cpm.get_project_finish(db, period_id)
    anchor = period.start_date or date.today()
    period.start_date = anchor + timedelta(days=shift_days)
    await db.commit()

    await scheduling_cpm.recompute_schedule(db, period_id)
    new_finish = await scheduling_cpm.get_project_finish(db, period_id)

    return {
        "shift_days": shift_days,
        "old_project_finish": old_finish,
        "new_project_finish": new_finish,
        "new_anchor_date": period.start_date,
        "new_anchor_time": period.start_time,
    }


async def set_data_date(db: AsyncSession, period_id: uuid.UUID, new_date: date, new_time: time | None) -> dict:
    """Pins the data date to an exact date and (optionally) time-of-day — the
    "set data date directly" mode of Reschedule, distinct from reschedule()'s
    relative day-shift. new_time=None reverts to "the calendar's day start"
    rather than leaving whatever time was previously pinned (2026-07-03, per
    Maro: new activities should anchor to "the current day and time depending
    on the default calendar assigned" — this is the action that sets that).
    """
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    await _require_live_period(db, period_id)

    old_finish = await scheduling_cpm.get_project_finish(db, period_id)
    period.start_date = new_date
    period.start_time = new_time
    await db.commit()

    await scheduling_cpm.recompute_schedule(db, period_id)
    new_finish = await scheduling_cpm.get_project_finish(db, period_id)

    return {
        "shift_days": None,
        "old_project_finish": old_finish,
        "new_project_finish": new_finish,
        "new_anchor_date": period.start_date,
        "new_anchor_time": period.start_time,
    }
