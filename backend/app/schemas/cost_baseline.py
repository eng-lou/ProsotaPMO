from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CostBaselineCreate(BaseModel):
    period_id: uuid.UUID
    name: str
    baseline_date: date


class CostBaselineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period_id: uuid.UUID
    name: str
    baseline_date: date
    baseline_set_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    item_count: int


class CostBaselineItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    cost_element_id: uuid.UUID
    code: str
    description: str
    bac: Decimal
    ac: Decimal | None
    pct_complete: int | None
