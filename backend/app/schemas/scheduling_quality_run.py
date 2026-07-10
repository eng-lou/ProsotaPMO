from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.scheduling_quality import QualityReport


class SchedulingQualityRunCreate(BaseModel):
    schedule_period_id: uuid.UUID
    name: str
    scope_subproject_id: uuid.UUID | None = None


class SchedulingQualityRunSummary(BaseModel):
    """List view — the full report is fetched separately (GET /{id}) so the
    list itself stays cheap."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    schedule_period_id: uuid.UUID
    name: str
    created_at: datetime
    logic_score: float | None
    failing_count: int
    warning_count: int
    scope_subproject_id: uuid.UUID | None
    scope_name: str | None


class SchedulingQualityRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    schedule_period_id: uuid.UUID
    name: str
    created_at: datetime
    report: QualityReport
