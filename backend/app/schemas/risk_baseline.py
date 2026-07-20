from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class RiskBaselineCreate(BaseModel):
    period_id: uuid.UUID
    name: str
    baseline_date: date


class RiskBaselineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period_id: uuid.UUID
    name: str
    baseline_date: date
    baseline_set_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    # Server-computed, never accepted as input — matches
    # ScheduleBaselineResponse.activity_count's own pattern.
    item_count: int


class RiskBaselineItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    risk_id: uuid.UUID
    code: str
    title: str
    status: str
    rating: Decimal | None
    emv_cost: Decimal | None
    emv_schedule_days: Decimal | None
