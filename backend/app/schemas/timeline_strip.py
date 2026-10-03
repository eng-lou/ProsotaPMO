from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TimelineStripBase(BaseModel):
    title: str = Field(default="Timeline Strip", min_length=1, max_length=300)
    # A strip is created on purpose now (list CRUD, not a get-or-default
    # singleton), so it starts visible — same as RadialChart.
    visible: bool = True
    position_x_pct: float = Field(default=10.0, ge=0, le=100)
    position_y_pct: float = Field(default=90.0, ge=0, le=100)
    width_px: float = Field(default=900.0, gt=0)
    height_px: float = Field(default=56.0, gt=0)
    background_color: str = Field(default="#1f2937", max_length=9)
    band_border_color: str = Field(default="#ffffff", max_length=9)
    text_color: str = Field(default="#ffffff", max_length=9)
    playhead_color: str = Field(default="#ef4444", max_length=9)
    font_size: float = Field(default=11.0, gt=0)
    scope_mode: str = Field(default="all", max_length=10)
    udf_field_definition_id: uuid.UUID | None = None
    udf_value: str | None = Field(default=None, max_length=500)
    wbs_node_activity_id: uuid.UUID | None = None
    viewport_slot: int | None = Field(default=None, ge=0, le=2)


class TimelineStripCreate(TimelineStripBase):
    project_id: uuid.UUID


class TimelineStripUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    visible: bool | None = None
    position_x_pct: float | None = Field(default=None, ge=0, le=100)
    position_y_pct: float | None = Field(default=None, ge=0, le=100)
    width_px: float | None = Field(default=None, gt=0)
    height_px: float | None = Field(default=None, gt=0)
    background_color: str | None = Field(default=None, max_length=9)
    band_border_color: str | None = Field(default=None, max_length=9)
    text_color: str | None = Field(default=None, max_length=9)
    playhead_color: str | None = Field(default=None, max_length=9)
    font_size: float | None = Field(default=None, gt=0)
    scope_mode: str | None = Field(default=None, max_length=10)
    udf_field_definition_id: uuid.UUID | None = None
    udf_value: str | None = Field(default=None, max_length=500)
    wbs_node_activity_id: uuid.UUID | None = None
    viewport_slot: int | None = Field(default=None, ge=0, le=2)


class TimelineStripResponse(TimelineStripBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
