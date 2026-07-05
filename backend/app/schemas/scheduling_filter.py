from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Mirrors frontend/src/modules/scheduling/types.ts's FilterFieldKey/FilterOperator —
# kept as an explicit allow-list (not a free string) so an imported/hand-edited
# filter file with a typo'd or unsupported field fails with a clean 422 here,
# rather than silently matching nothing once it reaches the frontend's own
# evaluateCondition.
FilterFieldKey = Literal[
    "code", "wbs_path", "task_name", "activity_type", "constraint_type",
    "is_critical", "is_archived",
    "start", "finish", "actual_start", "actual_finish", "bl_start", "bl_finish", "constraint_date",
    "duration_hours", "duration_days", "remaining_duration_hours", "bl_duration_hours",
    "variance_days", "total_float_hours", "free_float_hours", "pct_complete", "duration_pct_complete",
    "bac", "ac", "pv", "ev", "cv", "sv", "cpi", "spi", "eac", "etc",
]
FilterOperator = Literal["eq", "neq", "gt", "gte", "lt", "lte", "is_true", "is_false", "contains", "starts_with"]


class FilterCondition(BaseModel):
    field: FilterFieldKey
    operator: FilterOperator
    # Always a string on the wire (frontend coerces per field type at
    # evaluation time) — same "store as the simplest common type" choice as
    # GanttStyle's hex colours, avoids a union type for what's ultimately
    # just one comparison value per condition.
    value: str = ""


class SchedulingFilterBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    match_mode: Literal["all", "any"] = "all"
    conditions: list[FilterCondition] = Field(default_factory=list)


class SchedulingFilterCreate(SchedulingFilterBase):
    project_id: uuid.UUID


class SchedulingFilterUpdate(SchedulingFilterBase):
    pass


class SchedulingFilterResponse(SchedulingFilterBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
