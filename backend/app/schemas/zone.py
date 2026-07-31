from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ZonePoint(BaseModel):
    x: float
    y: float
    z: float


class ZoneBase(BaseModel):
    name: str = Field(default="Zone", min_length=1, max_length=300)
    shape: str = Field(default="polygon", max_length=10)
    points: list[ZonePoint] = Field(default_factory=list)
    radius: float = Field(default=5.0, gt=0)
    elevation: float = 0.0
    fill_color: str = Field(default="#ef4444", max_length=9)
    fill_opacity: float = Field(default=0.35, ge=0, le=1)
    border_color: str = Field(default="#ffffff", max_length=9)
    border_width: int = Field(default=2, ge=1, le=20)
    border_style: str = Field(default="solid", max_length=10)
    border_dash_size: float = Field(default=0.5, gt=0)
    border_gap_size: float = Field(default=0.3, gt=0)
    visible: bool = True
    animate: bool = False
    animation_loop: bool = False
    animation_mode: str = Field(default="draw", max_length=10)


class ZoneCreate(ZoneBase):
    project_id: uuid.UUID


class ZoneUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    shape: str | None = Field(default=None, max_length=10)
    points: list[ZonePoint] | None = None
    radius: float | None = Field(default=None, gt=0)
    elevation: float | None = None
    fill_color: str | None = Field(default=None, max_length=9)
    fill_opacity: float | None = Field(default=None, ge=0, le=1)
    border_color: str | None = Field(default=None, max_length=9)
    border_width: int | None = Field(default=None, ge=1, le=20)
    border_style: str | None = Field(default=None, max_length=10)
    border_dash_size: float | None = Field(default=None, gt=0)
    border_gap_size: float | None = Field(default=None, gt=0)
    visible: bool | None = None
    animate: bool | None = None
    animation_loop: bool | None = None
    animation_mode: str | None = Field(default=None, max_length=10)


class ZoneResponse(ZoneBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
