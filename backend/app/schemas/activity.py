from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ActivityType = Literal["task", "milestone", "wbs_summary"]
ConstraintType = Literal["asap", "snet", "ms", "fnlt"]


def _validate_constraint(constraint_type: ConstraintType | None, constraint_date: date | None) -> None:
    if constraint_type in (None, "asap") and constraint_date is not None:
        raise ValueError("constraint_date must be null unless a constraint type requiring a date is set")
    if constraint_type not in (None, "asap") and constraint_date is None:
        raise ValueError(f"constraint_date is required for constraint_type '{constraint_type}'")


class ActivityBase(BaseModel):
    task_name: str
    # activity_type is client-settable at create time, but from then on it's
    # auto-managed by app/services/activity.py:_recompute_hierarchy whenever the
    # activity gains/loses children (MS Project style — see Phase 2 of the plan).
    activity_type: ActivityType = "task"
    parent_id: uuid.UUID | None = None
    duration_days: int | None = Field(default=None, ge=0)
    start: date | None = None
    finish: date | None = None
    actual_start: date | None = None
    actual_finish: date | None = None
    remaining_duration_days: int | None = Field(default=None, ge=0)
    pct_complete: Decimal | None = Field(default=None, ge=0, le=100)
    commentary: str | None = None
    constraint_type: ConstraintType | None = None
    constraint_date: date | None = None
    # Null = inherit the project's default calendar — see app/services/calendar.py.
    calendar_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def milestones_have_zero_duration(self) -> "ActivityBase":
        if self.activity_type == "milestone":
            if self.duration_days not in (None, 0):
                raise ValueError("milestones have zero duration")
            self.duration_days = 0
        return self

    @model_validator(mode="after")
    def constraint_date_matches_type(self) -> "ActivityBase":
        _validate_constraint(self.constraint_type, self.constraint_date)
        return self


class ActivityCreate(ActivityBase):
    project_id: uuid.UUID
    period_id: uuid.UUID


class ActivityUpdate(BaseModel):
    task_name: str | None = None
    activity_type: ActivityType | None = None
    parent_id: uuid.UUID | None = None
    duration_days: int | None = Field(default=None, ge=0)
    start: date | None = None
    finish: date | None = None
    actual_start: date | None = None
    actual_finish: date | None = None
    remaining_duration_days: int | None = Field(default=None, ge=0)
    pct_complete: Decimal | None = Field(default=None, ge=0, le=100)
    commentary: str | None = None
    constraint_type: ConstraintType | None = None
    constraint_date: date | None = None
    calendar_id: uuid.UUID | None = None


class ActivityResponse(ActivityBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    project_id: uuid.UUID
    period_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    # Computed server-side only — see app/services/activity.py:_apply_computed_fields.
    # bl_start/bl_finish stay null until Phase 6 (Set Baseline); total_float/is_critical
    # stay null until Phase 5 (CPM engine) rather than holding a placeholder value.
    bl_start: date | None = None
    bl_finish: date | None = None
    variance_days: int | None = None
    total_float: int | None = None
    is_critical: bool | None = None
    # Server-managed outline position — see app/services/activity.py:_recompute_hierarchy.
    # Never accepted as API input; sort_order is exposed for future drag-reorder use.
    wbs_path: str | None = None
    sort_order: int | None = None
