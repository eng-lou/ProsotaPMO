from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CameraViewBase(BaseModel):
    name: str = Field(default="Camera View", min_length=1, max_length=300)
    position_x: float
    position_y: float
    position_z: float
    target_x: float
    target_y: float
    target_z: float


class CameraViewCreate(CameraViewBase):
    project_id: uuid.UUID


class CameraViewUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    position_x: float | None = None
    position_y: float | None = None
    position_z: float | None = None
    target_x: float | None = None
    target_y: float | None = None
    target_z: float | None = None


class CameraViewResponse(CameraViewBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
