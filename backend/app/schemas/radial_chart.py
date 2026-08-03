from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RadialChartBase(BaseModel):
    title: str = Field(default="Radial Chart", min_length=1, max_length=300)
    visible: bool = True
    position_x_pct: float = Field(default=4.0, ge=0, le=100)
    position_y_pct: float = Field(default=70.0, ge=0, le=100)
    radius_px: float = Field(default=48.0, gt=0)
    thickness_px: float = Field(default=8.0, gt=0)
    border_color: str = Field(default="#ffffff", max_length=9)
    track_color: str = Field(default="#374151", max_length=9)
    progress_color: str = Field(default="#f97316", max_length=9)
    fill_color: str = Field(default="#111827", max_length=9)
    text_color: str = Field(default="#ffffff", max_length=9)
    center_mode: str = Field(default="percentage", max_length=12)
    udf_field_definition_id: uuid.UUID | None = None
    udf_value: str | None = Field(default=None, max_length=500)
    scope_mode: str = Field(default="all", max_length=10)
    wbs_node_activity_id: uuid.UUID | None = None
    font_size: float = Field(default=14.0, gt=0)


class RadialChartCreate(RadialChartBase):
    project_id: uuid.UUID


class RadialChartUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    visible: bool | None = None
    position_x_pct: float | None = Field(default=None, ge=0, le=100)
    position_y_pct: float | None = Field(default=None, ge=0, le=100)
    radius_px: float | None = Field(default=None, gt=0)
    thickness_px: float | None = Field(default=None, gt=0)
    border_color: str | None = Field(default=None, max_length=9)
    track_color: str | None = Field(default=None, max_length=9)
    progress_color: str | None = Field(default=None, max_length=9)
    fill_color: str | None = Field(default=None, max_length=9)
    text_color: str | None = Field(default=None, max_length=9)
    center_mode: str | None = Field(default=None, max_length=12)
    udf_field_definition_id: uuid.UUID | None = None
    udf_value: str | None = Field(default=None, max_length=500)
    scope_mode: str | None = Field(default=None, max_length=10)
    wbs_node_activity_id: uuid.UUID | None = None
    font_size: float | None = Field(default=None, gt=0)


class RadialChartResponse(RadialChartBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    icon_storage_filename: str | None
    created_at: datetime
    updated_at: datetime
