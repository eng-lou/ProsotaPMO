from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Align = Literal["left", "center", "right", "justify"]

# ~500KB of raw bytes, base64-inflated (~4/3x) plus the "data:image/...;base64,"
# prefix — generous for a logo, small enough to keep in a DB text column
# without needing real file storage (see app/models/project_letterhead.py).
MAX_LOGO_DATA_URL_LENGTH = 700_000


class LetterheadZone(BaseModel):
    text: str = ""
    bold: bool = False
    italic: bool = False
    font_size: int = Field(default=11, ge=6, le=32)
    align: Align = "left"


class ProjectLetterheadUpsert(BaseModel):
    project_id: uuid.UUID
    logo_data_url: str | None = None
    logo_position: Literal["left", "center", "right"] = "left"
    header_left: LetterheadZone = LetterheadZone()
    header_center: LetterheadZone = LetterheadZone()
    header_right: LetterheadZone = LetterheadZone()
    footer_left: LetterheadZone = LetterheadZone()
    footer_center: LetterheadZone = LetterheadZone()
    footer_right: LetterheadZone = LetterheadZone()
    # Preset "how to read the Gantt" key (colour/shape legend) — see
    # app/models/project_letterhead.py. Only Scheduling's print view renders
    # it; harmless (ignored) elsewhere.
    show_gantt_legend: bool = False

    @field_validator("logo_data_url")
    @classmethod
    def _check_logo_size(cls, v: str | None) -> str | None:
        if v is not None and len(v) > MAX_LOGO_DATA_URL_LENGTH:
            raise ValueError("Logo is too large — please use a smaller image (roughly under 500KB).")
        return v


class ProjectLetterheadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # None = nothing saved yet for this project — get_or_default returns an
    # in-memory default in that case rather than a DB row, so the frontend
    # doesn't have to special-case a 404.
    id: uuid.UUID | None = None
    project_id: uuid.UUID
    logo_data_url: str | None
    logo_position: Literal["left", "center", "right"]
    header_left: LetterheadZone
    header_center: LetterheadZone
    header_right: LetterheadZone
    footer_left: LetterheadZone
    footer_center: LetterheadZone
    footer_right: LetterheadZone
    show_gantt_legend: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
