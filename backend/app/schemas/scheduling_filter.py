from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Mirrors frontend/src/modules/scheduling/types.ts's FilterFieldKey/FilterOperator —
# kept as an explicit allow-list (not a free string) so an imported/hand-edited
# filter file with a typo'd or unsupported field fails with a clean 422 here,
# rather than silently matching nothing once it reaches the frontend's own
# evaluateCondition.
_KNOWN_FILTER_FIELDS = frozenset([
    "code", "wbs_path", "task_name", "activity_type", "constraint_type",
    "is_critical", "is_archived",
    "start", "finish", "actual_start", "actual_finish", "bl_start", "bl_finish", "constraint_date",
    "duration_hours", "duration_days", "remaining_duration_hours", "bl_duration_hours",
    "variance_days", "total_float_hours", "free_float_hours", "sub_total_float_hours", "sub_is_critical",
    "pct_complete", "schedule_pct_complete",
    "bac", "ac", "pv", "ev", "cv", "sv", "cpi", "spi", "eac", "etc",
])
# A real per-project UDF, referenced as "udf.<Name>" (2026-09-06, per Maro:
# "any udfs from an imported schedule is missed out" — Filters/Highlights
# had no way to reference one at all before now; matches the exact same
# "udf.<Name>" convention app/schemas/dashboard_layout.py's own
# DashboardWidgetFilterCondition.field already allows unrestricted, since
# that one's plain str). FilterFieldKey itself stays a plain str (not a
# Literal) since a project's UDF names can't be known statically here —
# the validator below is what still rejects a genuinely bogus, non-UDF
# field with a clean 422, same protection the old Literal gave.
FilterFieldKey = str
FilterOperator = Literal["eq", "neq", "gt", "gte", "lt", "lte", "is_true", "is_false", "contains", "starts_with"]


class FilterCondition(BaseModel):
    field: FilterFieldKey
    operator: FilterOperator
    # Always a string on the wire (frontend coerces per field type at
    # evaluation time) — same "store as the simplest common type" choice as
    # GanttStyle's hex colours, avoids a union type for what's ultimately
    # just one comparison value per condition.
    value: str = ""

    @field_validator("field")
    @classmethod
    def _validate_field(cls, v: str) -> str:
        if v.startswith("udf.") and len(v) > len("udf."):
            return v
        if v in _KNOWN_FILTER_FIELDS:
            return v
        raise ValueError(f'"{v}" is not a recognized filter field (built-in, or "udf.<Name>")')


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
