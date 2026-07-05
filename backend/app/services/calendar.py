from __future__ import annotations

import uuid
from datetime import time

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import Calendar, CalendarBreak, CalendarException
from app.models.period import Period
from app.schemas.calendar import (
    CalendarBreakCreate,
    CalendarBreakUpdate,
    CalendarCreate,
    CalendarExceptionCreate,
    CalendarExceptionUpdate,
    CalendarUpdate,
    _validate_exception_times,
)
from app.services.calendar_time import compute_hours_per_day

_STANDARD_CALENDAR_NAME = "Standard Calendar"


async def _recompute_all_live_periods_for_project(db: AsyncSession, project_id: uuid.UUID) -> None:
    """A calendar change (working days, hours, breaks, non-working exceptions)
    can shift every already-computed date for activities using it — without
    this, saving a new exception looked like it did nothing at all, since
    nothing re-ran the CPM engine until some unrelated activity edit happened
    to trigger it (found 2026-07-04, per Maro: "add exception isn't working").

    Recomputes every *live* period in the project — frozen ones are
    deliberately skipped, since a calendar edit retroactively changing a
    frozen period's dates would break the "frozen = immutable" trust
    guarantee (ARCHITECTURE.md §3). Local import to avoid a circular
    dependency: scheduling_cpm already imports this module for calendar
    lookups."""
    from app.services import scheduling_cpm

    result = await db.execute(
        select(Period.id).where(Period.project_id == project_id, Period.freeze_status == "live")
    )
    for period_id in result.scalars().all():
        await scheduling_cpm.recompute_schedule(db, period_id)


async def _attach_hours_per_day(db: AsyncSession, calendars: list[Calendar]) -> None:
    """Attaches a transient `hours_per_day` attribute to each calendar (derived from
    its day envelope minus its breaks) so CalendarResponse can read it — see
    app/schemas/calendar.py:CalendarResponse. Not a stored column (Phase 10)."""
    if not calendars:
        return
    result = await db.execute(select(CalendarBreak).where(CalendarBreak.calendar_id.in_([c.id for c in calendars])))
    breaks_by_calendar: dict[uuid.UUID, list[CalendarBreak]] = {}
    for b in result.scalars().all():
        breaks_by_calendar.setdefault(b.calendar_id, []).append(b)
    for c in calendars:
        c.hours_per_day = compute_hours_per_day(c.day_start_time, c.day_end_time, breaks_by_calendar.get(c.id, []))


async def list_calendars(db: AsyncSession, project_id: uuid.UUID) -> list[Calendar]:
    result = await db.execute(select(Calendar).where(Calendar.project_id == project_id).order_by(Calendar.name))
    calendars = list(result.scalars().all())
    if not calendars:
        # Lazily seed a Mon-Fri/08:00-17:00 default (with a 12:00-13:00 lunch break,
        # netting the same 8h/day this project always defaulted to) on first access —
        # same pattern as Risk/ICD/Cost's criteria tables
        # (app/services/cost_variance_criterion.py). Seeding the break too means the
        # default calendar demonstrates Phase 10's "advanced calendar editor" feature
        # out of the box instead of starting with an empty, break-free envelope.
        standard = Calendar(project_id=project_id, name=_STANDARD_CALENDAR_NAME, is_project_default=True)
        db.add(standard)
        await db.commit()
        await db.refresh(standard)
        db.add(CalendarBreak(calendar_id=standard.id, label="Lunch", start_time=time(12, 0), end_time=time(13, 0)))
        await db.commit()
        calendars = [standard]
    await _attach_hours_per_day(db, calendars)
    return calendars


async def _get_calendar(db: AsyncSession, calendar_id: uuid.UUID) -> Calendar:
    calendar = await db.get(Calendar, calendar_id)
    if calendar is None:
        raise HTTPException(status_code=404, detail="Calendar not found")
    return calendar


async def _clear_existing_default(db: AsyncSession, project_id: uuid.UUID, exclude_id: uuid.UUID | None) -> None:
    q = select(Calendar).where(Calendar.project_id == project_id, Calendar.is_project_default.is_(True))
    if exclude_id is not None:
        q = q.where(Calendar.id != exclude_id)
    for existing_default in (await db.execute(q)).scalars().all():
        existing_default.is_project_default = False


async def create_calendar(db: AsyncSession, data: CalendarCreate) -> Calendar:
    calendar = Calendar(**data.model_dump())
    if calendar.is_project_default:
        await _clear_existing_default(db, data.project_id, exclude_id=None)
    db.add(calendar)
    await db.commit()
    await db.refresh(calendar)
    await _attach_hours_per_day(db, [calendar])
    return calendar


async def update_calendar(db: AsyncSession, calendar_id: uuid.UUID, data: CalendarUpdate) -> Calendar:
    calendar = await _get_calendar(db, calendar_id)
    updates = data.model_dump(exclude_unset=True)

    if updates.get("is_project_default") is False and calendar.is_project_default:
        raise HTTPException(
            status_code=422,
            detail="A project must always have a default calendar — set another calendar as default instead of unsetting this one",
        )
    if updates.get("is_project_default") is True:
        await _clear_existing_default(db, calendar.project_id, exclude_id=calendar.id)

    for field, value in updates.items():
        setattr(calendar, field, value)
    if calendar.day_end_time <= calendar.day_start_time:
        raise HTTPException(status_code=422, detail="day_end_time must be after day_start_time")
    await db.commit()
    await db.refresh(calendar)
    await _attach_hours_per_day(db, [calendar])
    await _recompute_all_live_periods_for_project(db, calendar.project_id)
    return calendar


async def delete_calendar(db: AsyncSession, calendar_id: uuid.UUID) -> None:
    calendar = await _get_calendar(db, calendar_id)
    if calendar.is_project_default:
        raise HTTPException(
            status_code=422,
            detail="Cannot delete the default calendar — set another calendar as default first",
        )
    project_id = calendar.project_id
    await db.delete(calendar)
    await db.commit()
    # Activities that had this calendar assigned revert to the project default
    # (ON DELETE SET NULL) — their effective calendar just changed too.
    await _recompute_all_live_periods_for_project(db, project_id)


async def list_exceptions(db: AsyncSession, calendar_id: uuid.UUID) -> list[CalendarException]:
    result = await db.execute(
        select(CalendarException)
        .where(CalendarException.calendar_id == calendar_id)
        .order_by(CalendarException.start_date)
    )
    return list(result.scalars().all())


async def create_exception(db: AsyncSession, data: CalendarExceptionCreate) -> CalendarException:
    calendar = await _get_calendar(db, data.calendar_id)
    exception = CalendarException(**data.model_dump())
    db.add(exception)
    await db.commit()
    await db.refresh(exception)
    await _recompute_all_live_periods_for_project(db, calendar.project_id)
    return exception


async def update_exception(
    db: AsyncSession, exception_id: uuid.UUID, data: CalendarExceptionUpdate
) -> CalendarException:
    exception = await db.get(CalendarException, exception_id)
    if exception is None:
        raise HTTPException(status_code=404, detail="Calendar exception not found")
    calendar = await _get_calendar(db, exception.calendar_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(exception, field, value)
    if exception.end_date < exception.start_date:
        raise HTTPException(status_code=422, detail="end_date cannot be before start_date")
    try:
        _validate_exception_times(exception.start_time, exception.end_time)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await db.commit()
    await db.refresh(exception)
    await _recompute_all_live_periods_for_project(db, calendar.project_id)
    return exception


async def delete_exception(db: AsyncSession, exception_id: uuid.UUID) -> None:
    exception = await db.get(CalendarException, exception_id)
    if exception is None:
        raise HTTPException(status_code=404, detail="Calendar exception not found")
    calendar = await _get_calendar(db, exception.calendar_id)
    await db.delete(exception)
    await db.commit()
    await _recompute_all_live_periods_for_project(db, calendar.project_id)


async def list_breaks(db: AsyncSession, calendar_id: uuid.UUID) -> list[CalendarBreak]:
    result = await db.execute(
        select(CalendarBreak).where(CalendarBreak.calendar_id == calendar_id).order_by(CalendarBreak.start_time)
    )
    return list(result.scalars().all())


async def create_break(db: AsyncSession, data: CalendarBreakCreate) -> CalendarBreak:
    calendar = await _get_calendar(db, data.calendar_id)
    calendar_break = CalendarBreak(**data.model_dump())
    db.add(calendar_break)
    await db.commit()
    await db.refresh(calendar_break)
    await _recompute_all_live_periods_for_project(db, calendar.project_id)
    return calendar_break


async def update_break(db: AsyncSession, break_id: uuid.UUID, data: CalendarBreakUpdate) -> CalendarBreak:
    calendar_break = await db.get(CalendarBreak, break_id)
    if calendar_break is None:
        raise HTTPException(status_code=404, detail="Calendar break not found")
    calendar = await _get_calendar(db, calendar_break.calendar_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(calendar_break, field, value)
    if calendar_break.end_time <= calendar_break.start_time:
        raise HTTPException(status_code=422, detail="end_time must be after start_time")
    await db.commit()
    await db.refresh(calendar_break)
    await _recompute_all_live_periods_for_project(db, calendar.project_id)
    return calendar_break


async def delete_break(db: AsyncSession, break_id: uuid.UUID) -> None:
    calendar_break = await db.get(CalendarBreak, break_id)
    if calendar_break is None:
        raise HTTPException(status_code=404, detail="Calendar break not found")
    calendar = await _get_calendar(db, calendar_break.calendar_id)
    await db.delete(calendar_break)
    await db.commit()
    await _recompute_all_live_periods_for_project(db, calendar.project_id)
