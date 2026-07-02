from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ActivityType = Literal["task", "milestone", "wbs_summary"]
ConstraintType = Literal["asap", "snet", "ms", "fnlt"]


def _validate_constraint(constraint_type: ConstraintType | None, constraint_date: datetime | None) -> None:
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
    # Phase 10 (hour-level CPM): duration_hours is the primary input now — hours, not
    # whole days, so 08:00-09:00-style partial-day calendar detail can actually change
    # a computed finish time, not just look nice in a widget. See
    # docs/SCHEDULING_MODULE_PLAN.md Phase 10.
    duration_hours: Decimal | None = Field(default=None, ge=0)
    actual_start: datetime | None = None
    actual_finish: datetime | None = None
    remaining_duration_hours: Decimal | None = Field(default=None, ge=0)
    pct_complete: Decimal | None = Field(default=None, ge=0, le=100)
    commentary: str | None = None
    constraint_type: ConstraintType | None = None
    constraint_date: datetime | None = None
    # Null = inherit the project's default calendar — see app/services/calendar.py.
    calendar_id: uuid.UUID | None = None
    last_reviewed_date: date | None = None

    @model_validator(mode="after")
    def milestones_have_zero_duration(self) -> "ActivityBase":
        if self.activity_type == "milestone":
            if self.duration_hours not in (None, 0):
                raise ValueError("milestones have zero duration")
            self.duration_hours = Decimal("0")
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
    # Manually editable, unlike create (where it's auto-assigned) — see
    # app/services/activity.py:update_activity for the per-project uniqueness check.
    code: str | None = None
    activity_type: ActivityType | None = None
    parent_id: uuid.UUID | None = None
    duration_hours: Decimal | None = Field(default=None, ge=0)
    # Write-only: editing Finish is translated server-side into the duration that
    # produces it (Start stays put) — P6/MS Project convention. Never stored as
    # given; see app/services/scheduling_cpm.py:compute_duration_for_finish. Editing
    # Start instead applies a Mandatory Start constraint (constraint_type/
    # constraint_date below) — there's deliberately no separate "start" input field.
    finish: datetime | None = None
    actual_start: datetime | None = None
    actual_finish: datetime | None = None
    remaining_duration_hours: Decimal | None = Field(default=None, ge=0)
    pct_complete: Decimal | None = Field(default=None, ge=0, le=100)
    commentary: str | None = None
    constraint_type: ConstraintType | None = None
    constraint_date: datetime | None = None
    calendar_id: uuid.UUID | None = None
    last_reviewed_date: date | None = None


class ActivityResponse(ActivityBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    project_id: uuid.UUID
    period_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    # start/finish are computed by app/services/scheduling_cpm.py (forward/backward
    # pass) from Phase 5 onward — never accepted as API input. bl_start/bl_finish/
    # bl_duration_hours are set only by the "Set Baseline" action
    # (app/services/scheduling_baseline.py); total_float_hours/free_float_hours/
    # is_critical are null for wbs_summary rows (outside the CPM network) rather than
    # a placeholder. duration_days is a computed display value (duration_hours /
    # the resolved calendar's net hours/day) — see app/models/activity.py.
    duration_days: Decimal | None = None
    start: datetime | None = None
    finish: datetime | None = None
    bl_start: datetime | None = None
    bl_finish: datetime | None = None
    bl_duration_hours: Decimal | None = None
    variance_days: int | None = None
    total_float_hours: Decimal | None = None
    free_float_hours: Decimal | None = None
    is_critical: bool | None = None
    # Server-managed outline position — see app/services/activity.py:_recompute_hierarchy.
    # Never accepted as API input; sort_order is exposed for future drag-reorder use.
    wbs_path: str | None = None
    sort_order: int | None = None
