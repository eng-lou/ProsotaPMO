from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.schedule_variant import ScheduleVariantResponse


class ScheduleBaselineCreate(BaseModel):
    schedule_period_id: uuid.UUID
    name: str
    baseline_date: date


class ScheduleBaselineFromVariantCreate(BaseModel):
    """Cross-variant baselining (docs/SCHEDULE_VARIANTS_PLAN.md §D.7) — the
    baseline still belongs to schedule_period_id (the target), but its
    activity snapshots are sourced from source_schedule_variant_id's own
    current live schedule instead of the target's own current state, matched
    by activity code. See app/services/schedule_baseline.py:
    create_baseline_from_variant."""
    schedule_period_id: uuid.UUID
    source_schedule_variant_id: uuid.UUID
    name: str
    baseline_date: date


class ScheduleBaselineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    schedule_period_id: uuid.UUID
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


class PromoteBaselineCreate(BaseModel):
    """"Open a baseline as a working schedule" (2026-07-07, per Maro —
    docs/SCHEDULING_GAPS_PLAN.md Phase 6) — creates a brand new
    ScheduleVariant seeded from this baseline's own snapshot, not a
    read-only comparison. See
    app/services/schedule_baseline.py:promote_baseline_to_variant."""
    name: str = Field(min_length=1, max_length=200)
    variant_type: str | None = None


class PromoteBaselineResponse(BaseModel):
    """Mirrors schedule_variant.py's own PromoteVariantResponse shape —
    surfaces whether the new variant's relationships came from this
    baseline's own captured snapshot (schedule_baseline_relationships) or
    had to fall back to the *current live* relationships, for a baseline
    captured before that snapshot existed."""
    variant: ScheduleVariantResponse
    relationships_from_baseline_snapshot: bool


class ScheduleBaselineActivityResponse(BaseModel):
    """One activity's snapshot within a saved baseline — code is what that
    activity was called at capture time, which can differ from its code now
    if it's since been promoted/demoted/renamed (2026-07-04, per Maro: "what
    it was in the baseline" for code traceability)."""
    model_config = ConfigDict(from_attributes=True)

    activity_id: uuid.UUID
    code: str
    start: datetime | None
    finish: datetime | None
    duration_hours: Decimal | None = None
