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
    period_id: uuid.UUID
    activity_count: int
    # None when activity_count is 0 — "no activities" isn't a 0% logic score,
    # it's not a meaningful score at all (2026-07-03, per Maro).
    logic_score: float | None
    checks: list[QualityCheck]
