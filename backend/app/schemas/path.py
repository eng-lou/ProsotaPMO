from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PathPoint(BaseModel):
    x: float
    y: float
    z: float


class PathBase(BaseModel):
    name: str = Field(default="Path", min_length=1, max_length=300)
    points: list[PathPoint] = Field(default_factory=list)
    closed: bool = False
    visible: bool = True


class PathCreate(PathBase):
    project_id: uuid.UUID


class PathUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    points: list[PathPoint] | None = None
    closed: bool | None = None
    visible: bool | None = None


class PathResponse(PathBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
