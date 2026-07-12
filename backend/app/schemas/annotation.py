from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AnnotationKind = Literal["placemark", "footnote", "comment"]
AnnotationIcon = Literal["pin", "flag", "comment", "warning"]
AnnotationStatus = Literal["open", "resolved"]


class AnnotationBase(BaseModel):
    kind: AnnotationKind
    position_x: float
    position_y: float
    position_z: float
    source_kind: Literal["ifc", "mesh"] | None = None
    element_ref: str | None = Field(default=None, max_length=300)
    text: str = Field(default="", max_length=2000)
    icon: AnnotationIcon = "pin"
    visible: bool = True
    has_background: bool = True
    background_color: str = Field(default="#f59e0b", max_length=9)
    border_color: str = Field(default="#ffffff", max_length=9)
    thick_border: bool = False
    text_color: str = Field(default="#111827", max_length=9)
    font_size: int = Field(default=14, ge=8, le=72)
    hide_closer_than: float | None = Field(default=None, ge=0)
    hide_farther_than: float | None = Field(default=None, ge=0)
    status: AnnotationStatus = "open"


class AnnotationCreate(AnnotationBase):
    project_id: uuid.UUID


class AnnotationUpdate(BaseModel):
    position_x: float | None = None
    position_y: float | None = None
    position_z: float | None = None
    source_kind: Literal["ifc", "mesh"] | None = None
    element_ref: str | None = Field(default=None, max_length=300)
    text: str | None = Field(default=None, max_length=2000)
    icon: AnnotationIcon | None = None
    visible: bool | None = None
    has_background: bool | None = None
    background_color: str | None = Field(default=None, max_length=9)
    border_color: str | None = Field(default=None, max_length=9)
    thick_border: bool | None = None
    text_color: str | None = Field(default=None, max_length=9)
    font_size: int | None = Field(default=None, ge=8, le=72)
    hide_closer_than: float | None = Field(default=None, ge=0)
    hide_farther_than: float | None = Field(default=None, ge=0)
    status: AnnotationStatus | None = None


class AnnotationResponse(AnnotationBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
