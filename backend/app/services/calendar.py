from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import Calendar, CalendarException
from app.schemas.calendar import (
    CalendarCreate,
    CalendarExceptionCreate,
    CalendarExceptionUpdate,
    CalendarUpdate,
)

_STANDARD_CALENDAR_NAME = "Standard Calendar"


async def list_calendars(db: AsyncSession, project_id: uuid.UUID) -> list[Calendar]:
    result = await db.execute(select(Calendar).where(Calendar.project_id == project_id).order_by(Calendar.name))
    calendars = list(result.scalars().all())
    if calendars:
        return calendars

    # Lazily seed a Mon-Fri/8h default on first access — same pattern as Risk/ICD/
    # Cost's criteria tables (app/services/cost_variance_criterion.py).
    standard = Calendar(project_id=project_id, name=_STANDARD_CALENDAR_NAME, is_project_default=True)
    db.add(standard)
    await db.commit()
    await db.refresh(standard)
    return [standard]


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
    await db.commit()
    await db.refresh(calendar)
    return calendar


async def delete_calendar(db: AsyncSession, calendar_id: uuid.UUID) -> None:
    calendar = await _get_calendar(db, calendar_id)
    if calendar.is_project_default:
        raise HTTPException(
            status_code=422,
            detail="Cannot delete the default calendar — set another calendar as default first",
        )
    await db.delete(calendar)
    await db.commit()


async def list_exceptions(db: AsyncSession, calendar_id: uuid.UUID) -> list[CalendarException]:
    result = await db.execute(
        select(CalendarException)
        .where(CalendarException.calendar_id == calendar_id)
        .order_by(CalendarException.start_date)
    )
    return list(result.scalars().all())


async def create_exception(db: AsyncSession, data: CalendarExceptionCreate) -> CalendarException:
    await _get_calendar(db, data.calendar_id)
    exception = CalendarException(**data.model_dump())
    db.add(exception)
    await db.commit()
    await db.refresh(exception)
    return exception


async def update_exception(
    db: AsyncSession, exception_id: uuid.UUID, data: CalendarExceptionUpdate
) -> CalendarException:
    exception = await db.get(CalendarException, exception_id)
    if exception is None:
        raise HTTPException(status_code=404, detail="Calendar exception not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(exception, field, value)
    if exception.end_date < exception.start_date:
        raise HTTPException(status_code=422, detail="end_date cannot be before start_date")
    await db.commit()
    await db.refresh(exception)
    return exception


async def delete_exception(db: AsyncSession, exception_id: uuid.UUID) -> None:
    exception = await db.get(CalendarException, exception_id)
    if exception is None:
        raise HTTPException(status_code=404, detail="Calendar exception not found")
    await db.delete(exception)
    await db.commit()
