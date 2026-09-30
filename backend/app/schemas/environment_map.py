from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EnvironmentMapResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    size_bytes: int
    created_at: datetime


class EnvironmentMapCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    storage_key: str
