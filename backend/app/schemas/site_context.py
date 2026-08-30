from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SiteContextUpsert(BaseModel):
    project_id: uuid.UUID
    enabled: bool = False
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    elevation: float = 0.0
    label: str | None = Field(default=None, max_length=300)
    offset_x: float = 0.0
    offset_y: float = 0.0
    offset_z: float = 0.0
    offset_yaw_deg: float = 0.0
    scale: float = Field(default=1.0, gt=0)


class SiteContextResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # None = nothing saved yet for this project — get_or_default returns an
    # in-memory default in that case rather than a DB row, same convention
    # as TimelineStripResponse/ProjectLetterheadResponse.
    id: uuid.UUID | None = None
    project_id: uuid.UUID
    enabled: bool
    lat: float | None
    lon: float | None
    elevation: float
    label: str | None
    offset_x: float
    offset_y: float
    offset_z: float
    offset_yaw_deg: float
    scale: float
    created_at: datetime | None = None
    updated_at: datetime | None = None
