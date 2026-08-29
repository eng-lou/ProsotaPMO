from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TimelineStripUpsert(BaseModel):
    project_id: uuid.UUID
    visible: bool = False
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


class TimelineStripResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # None = nothing saved yet for this project — get_or_default returns an
    # in-memory default in that case rather than a DB row, same convention
    # as ProjectLetterheadResponse.
    id: uuid.UUID | None = None
    project_id: uuid.UUID
    visible: bool
    position_x_pct: float
    position_y_pct: float
    width_px: float
    height_px: float
    background_color: str
    band_border_color: str
    text_color: str
    playhead_color: str
    font_size: float
    scope_mode: str
    udf_field_definition_id: uuid.UUID | None
    udf_value: str | None
    wbs_node_activity_id: uuid.UUID | None
    created_at: datetime | None = None
    updated_at: datetime | None = None
