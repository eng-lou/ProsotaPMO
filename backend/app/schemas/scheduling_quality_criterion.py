from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class SchedulingQualityCriterionUpdate(BaseModel):
    threshold: Decimal = Field(ge=0, le=100)


class SchedulingQualityCriterionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    check_number: int
    threshold: Decimal
    created_at: datetime
    updated_at: datetime
