from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

RecordType = Literal["risk", "icd_item", "cost_element", "activity"]


class ReassessmentCreate(BaseModel):
    record_type: RecordType
    record_id: uuid.UUID
    note: str


class ReassessmentUpdate(BaseModel):
    note: str


class ReassessmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    record_type: RecordType
    record_id: uuid.UUID
    note: str
    reviewed_at: datetime
