from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class SpreadCellResponse(BaseModel):
    """One (assignment, day) hours value — override if the user has hand-
    edited that day, otherwise the calendar-derived default. See
    app/services/resource_assignment_spread.py:default_hours_for_day."""
    assignment_id: uuid.UUID
    date: date
    hours: Decimal
    is_override: bool


class SpreadCapacityDay(BaseModel):
    """One resource's own working-day capacity — independent of any single
    assignment, used by the frontend to sum against SpreadCellResponse.hours
    and flag overallocated periods red. 0 on a day the resource's own
    calendar (or the project default, if it has none) isn't working."""
    date: date
    capacity: Decimal


class ResourceSpreadResponse(BaseModel):
    days: list[SpreadCapacityDay]
    cells: list[SpreadCellResponse]


class SpreadRangeUpdate(BaseModel):
    """Editing a cell at any zoom — day/week/month/quarter/year — arrives
    here as one requested total for a date range; see
    app/services/resource_assignment_spread.py:set_spread_range for how it's
    evenly distributed across the *working* days in that range, clipped to
    the assignment's own activity's current start/finish (cells outside that
    span aren't valid edit targets, 2026-07-07 per Maro)."""
    resource_assignment_id: uuid.UUID
    period_start: date
    period_end: date
    total_hours: Decimal = Field(ge=0)
