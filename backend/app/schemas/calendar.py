from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CalendarBase(BaseModel):
    name: str
    is_project_default: bool = False
    hours_per_day: Decimal = Field(default=Decimal("8"), gt=0, le=24)
    works_monday: bool = True
    works_tuesday: bool = True
    works_wednesday: bool = True
    works_thursday: bool = True
    works_friday: bool = True
    works_saturday: bool = False
    works_sunday: bool = False


class CalendarCreate(CalendarBase):
    project_id: uuid.UUID


class CalendarUpdate(BaseModel):
    name: str | None = None
    is_project_default: bool | None = None
    hours_per_day: Decimal | None = Field(default=None, gt=0, le=24)
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
    created_at: datetime
    updated_at: datetime


class CalendarExceptionBase(BaseModel):
    label: str
    start_date: date
    end_date: date
    is_working: bool = False

    @model_validator(mode="after")
    def end_not_before_start(self) -> "CalendarExceptionBase":
        if self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self


class CalendarExceptionCreate(CalendarExceptionBase):
    calendar_id: uuid.UUID


class CalendarExceptionUpdate(BaseModel):
    label: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    is_working: bool | None = None


class CalendarExceptionResponse(CalendarExceptionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    calendar_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
