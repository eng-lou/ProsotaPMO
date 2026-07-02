from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CalendarBase(BaseModel):
    name: str
    is_project_default: bool = False
    # Phase 10: hours_per_day is no longer typed in directly — it's derived from
    # day_start_time/day_end_time minus CalendarBreak spans (see
    # app/services/calendar_time.py:compute_hours_per_day). CalendarResponse below
    # exposes the derived value read-only; it's never accepted here as input.
    day_start_time: time = time(8, 0)
    day_end_time: time = time(17, 0)
    works_monday: bool = True
    works_tuesday: bool = True
    works_wednesday: bool = True
    works_thursday: bool = True
    works_friday: bool = True
    works_saturday: bool = False
    works_sunday: bool = False

    @model_validator(mode="after")
    def end_after_start(self) -> "CalendarBase":
        if self.day_end_time <= self.day_start_time:
            raise ValueError("day_end_time must be after day_start_time")
        return self


class CalendarCreate(CalendarBase):
    project_id: uuid.UUID


class CalendarUpdate(BaseModel):
    name: str | None = None
    is_project_default: bool | None = None
    day_start_time: time | None = None
    day_end_time: time | None = None
    works_monday: bool | None = None
    works_tuesday: bool | None = None
    works_wednesday: bool | None = None
    works_thursday: bool | None = None
    works_friday: bool | None = None
    works_saturday: bool | None = None
    works_sunday: bool | None = None


class CalendarResponse(CalendarBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    # Computed server-side (app/services/calendar.py) from day_start_time/day_end_time
    # minus this calendar's breaks — attached as a transient attribute before the
    # response is built, same "never store what you can derive" rule as everywhere
    # else in this codebase.
    hours_per_day: Decimal
    created_at: datetime
    updated_at: datetime


class CalendarBreakBase(BaseModel):
    label: str
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def end_after_start(self) -> "CalendarBreakBase":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class CalendarBreakCreate(CalendarBreakBase):
    calendar_id: uuid.UUID


class CalendarBreakUpdate(BaseModel):
    label: str | None = None
    start_time: time | None = None
    end_time: time | None = None


class CalendarBreakResponse(CalendarBreakBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    calendar_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


def _validate_exception_times(start_time: time | None, end_time: time | None) -> None:
    if (start_time is None) != (end_time is None):
        raise ValueError("start_time and end_time must both be set, or both left null (whole-day exception)")
    if start_time is not None and end_time is not None and end_time <= start_time:
        raise ValueError("end_time must be after start_time")


class CalendarExceptionBase(BaseModel):
    label: str
    start_date: date
    end_date: date
    is_working: bool = False
    # Phase 10: null (both) = whole-day exception, original Phase 4 behaviour. Set
    # (both) = only that time window on each date in range is affected — e.g.
    # "08:00-09:00 non-working" on one specific date — rest of the day follows the
    # calendar's normal envelope. See app/services/calendar_time.py:day_windows.
    start_time: time | None = None
    end_time: time | None = None

    @model_validator(mode="after")
    def end_not_before_start(self) -> "CalendarExceptionBase":
        if self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        _validate_exception_times(self.start_time, self.end_time)
        return self


class CalendarExceptionCreate(CalendarExceptionBase):
    calendar_id: uuid.UUID


class CalendarExceptionUpdate(BaseModel):
    label: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    is_working: bool | None = None
    start_time: time | None = None
    end_time: time | None = None


class CalendarExceptionResponse(CalendarExceptionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    calendar_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
