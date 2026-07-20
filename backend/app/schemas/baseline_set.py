from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

BaselineModule = Literal["risk", "cost", "icd", "schedule"]


class BaselineSetCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    baseline_date: date


class CaptureAllCreate(BaselineSetCreate):
    period_id: uuid.UUID
    schedule_period_id: uuid.UUID


class BaselineSetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    baseline_date: date
    created_at: datetime
    updated_at: datetime


class BaselineLinkUpdate(BaseModel):
    module: BaselineModule
    baseline_id: uuid.UUID
    baseline_set_id: uuid.UUID | None
