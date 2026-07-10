from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ActivityStepCreate(BaseModel):
    activity_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)


class ActivityStepUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    is_complete: bool | None = None


class ActivityStepMoveRequest(BaseModel):
    direction: Literal["up", "down"]


class ActivityStepResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activity_id: uuid.UUID
    name: str
    is_complete: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime
