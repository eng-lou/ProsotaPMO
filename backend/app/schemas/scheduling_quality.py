from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel

Status = Literal["pass", "warn", "fail", "na"]


class QualityCheck(BaseModel):
    number: int
    name: str
    standard: str
    threshold_label: str
    actual: float | str | None
    status: Status
    # Codes of the participant activities that tripped this check — empty for
    # check 12 (Critical Path Test, already narrated in `actual`) and for any
    # check with status "na". Powers the frontend's "export with details" and
    # eventually a click-to-highlight-on-the-Gantt affordance.
    failing_activity_codes: list[str] = []


class QualityReport(BaseModel):
    schedule_period_id: uuid.UUID
    activity_count: int
    # None when activity_count is 0 — "no activities" isn't a 0% logic score,
    # it's not a meaningful score at all (2026-07-03, per Maro).
    logic_score: float | None
    checks: list[QualityCheck]
    # Scope (2026-07-06, per Maro — docs/SUBPROJECT_FLOAT_PLAN.md §F): null =
    # whole schedule (default, unchanged behaviour). Set = restricted to one
    # tagged sub-project's own subtree (including any further-nested
    # sub-projects' activities), with checks 6/7/12 reading each activity's
    # sub_total_float_hours/sub_is_critical instead of the master fields.
    # scope_name is denormalized here purely for display (the sub-project
    # could be renamed or untagged later) — same "snapshot what was actually
    # analyzed" reasoning as everything else this report captures.
    scope_subproject_id: uuid.UUID | None = None
    scope_name: str | None = None
