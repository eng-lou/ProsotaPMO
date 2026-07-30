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
    color: str = Field(default="#38bdf8", max_length=9)
    line_style: str = Field(default="solid", max_length=10)
    show_arrow: bool = False
    show_label: bool = False
    line_width: int = Field(default=2, ge=1, le=20)
    dash_size: float = Field(default=0.5, gt=0)
    gap_size: float = Field(default=0.3, gt=0)
    animate: bool = False
    animation_loop: bool = False


class PathCreate(PathBase):
    project_id: uuid.UUID


class PathUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    points: list[PathPoint] | None = None
    closed: bool | None = None
    visible: bool | None = None
    color: str | None = Field(default=None, max_length=9)
    line_style: str | None = Field(default=None, max_length=10)
    show_arrow: bool | None = None
    show_label: bool | None = None
    line_width: int | None = Field(default=None, ge=1, le=20)
    dash_size: float | None = Field(default=None, gt=0)
    gap_size: float | None = Field(default=None, gt=0)
    animate: bool | None = None
    animation_loop: bool | None = None


class PathResponse(PathBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
