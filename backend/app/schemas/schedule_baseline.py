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
    # Optional — links this baseline into a shared BaselineSet (Controls
    # Dashboard Phase 1b, see app/models/baseline_set.py). Only ever set via
    # app/services/baseline_set.py:capture_all/link_baseline, never accepted
    # as input on this table's own create endpoint.
    baseline_set_id: uuid.UUID | None
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


# Milestone Trend Analysis (2026-09-03, per Maro: "i need charts across
# baseline periods e.g milestones over time a trend analysis... whether
# milestones have improved or delayed over time" — a classic P6/PMBOK
# "milestone trend chart"/"banana chart": each milestone's own forecast date
# plotted once per saved baseline, in capture order, so a planner can see at
# a glance whether it's been sliding later (each point higher than the last)
# or pulling in. One point per (milestone, ScheduleBaseline) pair that
# actually has a snapshot row, matched by the milestone's own real
# activity_id (ScheduleBaselineActivity's own stable reference — see that
# model's own docstring), plus one final "Current" point from the milestone's
# live, un-baselined finish — never a fabricated in-between date.
class MilestoneTrendPoint(BaseModel):
    # None for the synthetic trailing "Current" point — every real captured
    # baseline has a real id.
    baseline_id: uuid.UUID | None
    baseline_name: str
    baseline_date: date
    finish: datetime | None


class MilestoneTrendSeries(BaseModel):
    activity_id: uuid.UUID
    code: str
    task_name: str
    points: list[MilestoneTrendPoint]


class MilestoneTrendResponse(BaseModel):
    series: list[MilestoneTrendSeries]
