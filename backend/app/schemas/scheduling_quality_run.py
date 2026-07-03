from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.scheduling_quality import QualityReport


class SchedulingQualityRunCreate(BaseModel):
    period_id: uuid.UUID
    name: str


class SchedulingQualityRunSummary(BaseModel):
    """List view — the full report is fetched separately (GET /{id}) so the
    list itself stays cheap."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period_id: uuid.UUID
    name: str
    created_at: datetime
    logic_score: float | None
    failing_count: int
    warning_count: int


class SchedulingQualityRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period_id: uuid.UUID
    name: str
    created_at: datetime
    report: QualityReport
