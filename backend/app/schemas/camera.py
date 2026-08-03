from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CameraBase(BaseModel):
    name: str = Field(default="Camera", min_length=1, max_length=300)
    base_position_x: float
    base_position_y: float
    base_position_z: float
    base_target_x: float
    base_target_y: float
    base_target_z: float
    base_focal_length: float = 50.0
    base_clip_start: float = 0.1
    base_clip_end: float = 10000.0


class CameraCreate(CameraBase):
    project_id: uuid.UUID


class CameraUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    base_position_x: float | None = None
    base_position_y: float | None = None
    base_position_z: float | None = None
    base_target_x: float | None = None
    base_target_y: float | None = None
    base_target_z: float | None = None
    base_focal_length: float | None = None
    base_clip_start: float | None = None
    base_clip_end: float | None = None


class CameraResponse(CameraBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
