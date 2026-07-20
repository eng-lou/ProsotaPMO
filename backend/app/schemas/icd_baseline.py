from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class IcdBaselineCreate(BaseModel):
    period_id: uuid.UUID
    name: str
    baseline_date: date


class IcdBaselineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period_id: uuid.UUID
    name: str
    baseline_date: date
    baseline_set_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    item_count: int


class IcdBaselineItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    icd_item_id: uuid.UUID
    code: str
    item_type: str
    title: str
    status: str
