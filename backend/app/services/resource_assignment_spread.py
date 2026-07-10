from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.resource_assignment_spread import ResourceAssignmentSpread
from app.services import cost_sync
from app.services.activity import _require_live_schedule_period
from app.services.resource_assignment import _attach_resource_fields
from app.services.scheduling_cpm import _build_calendar_lookup, _CalendarLookup

_HOURS = Decimal("0.01")

# Only the resource types utilisation_pct actually governs — see
# app/services/resource_costing.py. Material/subcontractor/cost have no
# meaningful "hours per day" concept and get their own spread mode later
# (Maro, 2026-07-07: "we'll see as it goes"). crew occupies activity time the
# same way labour/equipment does (2026-07-08, per Maro).
_TIME_BASED_TYPES = ("labour", "equipment", "crew")


def default_hours_for_day(
    lookup: _CalendarLookup, calendar, resource: Resource, assignment: ResourceAssignment,
    activity: Activity | None, day: date,
) -> Decimal:
    """Demand for one day — resource.max_hours_per_day x the assignment's own
    utilisation_pct, on any whole day within the activity's own [start,
    finish] span that's a working day per its calendar; 0 otherwise
    (2026-07-08, per Maro: "calculated based on the max h/d and utilisation
    per that activity"). Deliberately the resource's own flat daily capacity,
    not the calendar's own partial-day-precision working-hour count — this
    also matches the capacity/Limit figure below, both expressed in the same
    max_hours_per_day terms."""
    if activity is None or activity.start is None or activity.finish is None:
        return Decimal("0.00")
    if not (activity.start.date() <= day <= activity.finish.date()):
        return Decimal("0.00")
    if not lookup.is_working_day(calendar, day):
        return Decimal("0.00")
    utilisation = assignment.utilisation_pct if assignment.utilisation_pct is not None else Decimal(100)
    return (Decimal(str(resource.max_hours_per_day)) * utilisation / Decimal(100)).quantize(_HOURS)


async def get_spread_for_resource(
    db: AsyncSession, resource_id: uuid.UUID, start: date, end: date
) -> tuple[list[dict], list[dict]]:
    """Day-by-day hours (override-or-default) for every assignment under one
    resource across [start, end), plus that resource's own per-day capacity —
    the one call the Resource Tracking spreadsheet needs; bucketing into
    whatever zoom the frontend is showing happens client-side, same as
    GanttChart's own zoom (day-granularity here is the source of truth
    regardless of display zoom)."""
    resource = await db.get(Resource, resource_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    if resource.resource_type not in _TIME_BASED_TYPES:
        raise HTTPException(
            status_code=422, detail="Resource Tracking currently only covers labour/equipment resources"
        )

    assignments = list((
        await db.execute(select(ResourceAssignment).where(ResourceAssignment.resource_id == resource_id))
    ).scalars().all())

    lookup = await _build_calendar_lookup(db, resource.project_id)
    resource_calendar = lookup.resolve_calendar_id(resource.calendar_id)

    days: list[dict] = []
    d = start
    while d < end:
        capacity = resource.max_hours_per_day if lookup.is_working_day(resource_calendar, d) else Decimal("0.00")
        days.append({"date": d, "capacity": capacity})
        d += timedelta(days=1)

    if not assignments:
        return days, []

    activities_by_id = {a.id: a for a in (
        await db.execute(select(Activity).where(Activity.id.in_([a.activity_id for a in assignments])))
    ).scalars().all()}

    overrides_by_key: dict[tuple[uuid.UUID, date], Decimal] = {
        (o.resource_assignment_id, o.work_date): o.hours
        for o in (await db.execute(
            select(ResourceAssignmentSpread).where(
                ResourceAssignmentSpread.resource_assignment_id.in_([a.id for a in assignments]),
                ResourceAssignmentSpread.work_date >= start,
                ResourceAssignmentSpread.work_date < end,
            )
        )).scalars().all()
    }

    cells: list[dict] = []
    for a in assignments:
        activity = activities_by_id.get(a.activity_id)
        calendar = lookup.resolve(activity) if activity is not None else resource_calendar
        d = start
        while d < end:
            override = overrides_by_key.get((a.id, d))
            hours = override if override is not None else default_hours_for_day(lookup, calendar, resource, a, activity, d)
            cells.append({"assignment_id": a.id, "date": d, "hours": hours, "is_override": override is not None})
            d += timedelta(days=1)

    return days, cells


async def set_spread_range(
    db: AsyncSession, resource_assignment_id: uuid.UUID, period_start: date, period_end: date, total_hours: Decimal,
) -> None:
    """Editing a cell at any zoom (a single day, or a whole week/month/
    quarter/year) — evenly distributes total_hours across the *working* days
    in [period_start, period_end], clipped first to the assignment's own
    activity's current start/finish (2026-07-07, per Maro: "cells are
    editable only on the periods where they are actively assigned... unless
    that activity's details has been moved"). One override row per working
    day; the last day absorbs any rounding remainder so the sum is exact."""
    assignment = await db.get(ResourceAssignment, resource_assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Resource assignment not found")
    activity = await db.get(Activity, assignment.activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    await _require_live_schedule_period(db, activity.schedule_period_id)
    if activity.start is None or activity.finish is None:
        raise HTTPException(status_code=422, detail="This activity isn't scheduled yet")

    span_start_date, span_end_date = activity.start.date(), activity.finish.date()
    clipped_start = max(period_start, span_start_date)
    clipped_end = min(period_end, span_end_date)
    if clipped_end < clipped_start:
        raise HTTPException(
            status_code=422,
            detail="This period falls outside the activity's current Start/Finish — nothing to edit here.",
        )

    lookup = await _build_calendar_lookup(db, activity.project_id)
    calendar = lookup.resolve(activity)
    working_days = [
        clipped_start + timedelta(days=i)
        for i in range((clipped_end - clipped_start).days + 1)
        if lookup.is_working_day(calendar, clipped_start + timedelta(days=i))
    ]
    if not working_days:
        raise HTTPException(status_code=422, detail="No working days in this range.")

    per_day = (total_hours / len(working_days)).quantize(_HOURS)
    remainder = total_hours - per_day * (len(working_days) - 1)

    existing_by_date = {
        o.work_date: o for o in (await db.execute(
            select(ResourceAssignmentSpread).where(
                ResourceAssignmentSpread.resource_assignment_id == resource_assignment_id,
                ResourceAssignmentSpread.work_date.in_(working_days),
            )
        )).scalars().all()
    }
    for i, d in enumerate(working_days):
        hours = remainder if i == len(working_days) - 1 else per_day
        row = existing_by_date.get(d)
        if row is not None:
            row.hours = hours
        else:
            db.add(ResourceAssignmentSpread(resource_assignment_id=resource_assignment_id, work_date=d, hours=hours))
    await db.commit()


async def recalculate_costs(db: AsyncSession, resource_assignment_id: uuid.UUID) -> ResourceAssignment:
    """Reconciles a (possibly hand-leveled) time-phased spread back into the
    existing utilisation_pct-driven cost formula — doesn't invent a parallel
    cost model. new_utilisation_pct = total spread hours actually recorded
    across the activity's own span, as a fraction of that span's total
    calendar-available hours; everything downstream (Cost Plan/EVM) already
    reads off utilisation_pct via the existing cost_sync pipeline, so nothing
    else needs to change."""
    assignment = await db.get(ResourceAssignment, resource_assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Resource assignment not found")
    activity = await db.get(Activity, assignment.activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    await _require_live_schedule_period(db, activity.schedule_period_id)
    if activity.start is None or activity.finish is None:
        raise HTTPException(status_code=422, detail="This activity isn't scheduled yet")
    resource = await db.get(Resource, assignment.resource_id)
    if resource.resource_type not in _TIME_BASED_TYPES:
        raise HTTPException(
            status_code=422, detail="Recalculate Costs currently only applies to labour/equipment resources"
        )

    lookup = await _build_calendar_lookup(db, activity.project_id)
    calendar = lookup.resolve(activity)
    overrides_by_date = {
        o.work_date: o.hours for o in (await db.execute(
            select(ResourceAssignmentSpread).where(ResourceAssignmentSpread.resource_assignment_id == assignment.id)
        )).scalars().all()
    }

    max_hours_per_day = Decimal(str(resource.max_hours_per_day))
    total_spread_hours = Decimal("0.00")
    total_capacity_hours = Decimal("0.00")
    d = activity.start.date()
    while d <= activity.finish.date():
        if lookup.is_working_day(calendar, d):
            total_capacity_hours += max_hours_per_day
            override = overrides_by_date.get(d)
            if override is not None:
                total_spread_hours += override
            else:
                utilisation = assignment.utilisation_pct if assignment.utilisation_pct is not None else Decimal(100)
                total_spread_hours += (max_hours_per_day * utilisation / Decimal(100))
        d += timedelta(days=1)

    if total_capacity_hours <= 0:
        raise HTTPException(status_code=422, detail="This activity has no working time in its own span.")

    new_utilisation = (total_spread_hours / total_capacity_hours * Decimal(100)).quantize(_HOURS)
    # utilisation_pct's own schema constraint is 0 < x <= 100 (see
    # app/schemas/resource.py) — a deliberately overloaded spread (still
    # showing red/overallocated in the spreadsheet) can mathematically exceed
    # that, since it's compared against the resource's own *capacity*, not
    # this formula's 0-100% "share of one calendar day" scale. Clamped at the
    # ceiling rather than rejected — over-100% detail isn't lost anywhere
    # that matters, since the red overallocation flag itself lives in the
    # raw spread hours, not in utilisation_pct.
    new_utilisation = max(Decimal("0.01"), min(new_utilisation, Decimal("100")))
    assignment.utilisation_pct = new_utilisation
    await db.commit()
    await db.refresh(assignment)
    await cost_sync.sync_cost_element_from_resources(db, activity.id)
    await _attach_resource_fields(db, [assignment])
    return assignment
