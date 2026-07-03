from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class ScheduleBaselineCreate(BaseModel):
    period_id: uuid.UUID
    name: str
    baseline_date: date


class ScheduleBaselineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period_id: uuid.UUID
    name: str
    baseline_date: date
    # Whether this is the baseline currently populating bl_start/bl_finish on
    # activities — never accepted as input, only flipped by
    # app/services/schedule_baseline.py:assign_baseline.
    is_active: bool
    created_at: datetime
    updated_at: datetime
    # Server-computed, never accepted as input — how many activities this
    # snapshot actually covers, shown in the Baseline widget's saved-baseline
    # list so a planner isn't guessing what an old capture contains.
    activity_count: int
