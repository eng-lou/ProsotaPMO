from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Reuses the exact same field/operator allow-list as scheduling_filter.py's
# own FilterCondition — a highlight rule is built from identical conditions,
# just applied to tint a row instead of narrow the list (2026-07-06, per
# Maro: "works exactly like the filter").
from app.schemas.scheduling_filter import FilterCondition


class SchedulingHighlightBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    match_mode: Literal["all", "any"] = "all"
    conditions: list[FilterCondition] = Field(default_factory=list)


class SchedulingHighlightCreate(SchedulingHighlightBase):
    project_id: uuid.UUID


class SchedulingHighlightUpdate(SchedulingHighlightBase):
    pass


class SchedulingHighlightResponse(SchedulingHighlightBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
