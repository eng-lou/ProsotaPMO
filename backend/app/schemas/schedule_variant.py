from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ScheduleVariantCreate(BaseModel):
    project_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    variant_type: str | None = None
    # Blank = start with nothing but one fresh live SchedulePeriod; set = fork
    # the given variant's current live schedule (activities, relationships,
    # resource assignments, baselines, sub-projects — codes preserved) — see
    # app/services/schedule_variant.py:duplicate_schedule_variant.
    duplicate_from_variant_id: uuid.UUID | None = None


class ScheduleVariantUpdate(BaseModel):
    name: str | None = None
    variant_type: str | None = None


class ScheduleVariantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    variant_type: str | None
    is_master: bool
    created_at: datetime
    updated_at: datetime


class PromoteVariantResponse(BaseModel):
    """Result of promoting a variant to master — surfaces anything that
    couldn't be carried across cleanly (2026-07-07, per Maro:
    docs/SCHEDULE_VARIANTS_PLAN.md §D.5 — SET NULL + a notice, not a silent
    drop or a hard block)."""
    variant: ScheduleVariantResponse
    unmatched_codes: list[str]
