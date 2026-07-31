from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AnnotationKind = Literal["placemark", "comment"]
AnnotationIcon = Literal["pin", "flag", "comment", "warning"]
AnnotationBoxShape = Literal["rounded", "rectangle"]


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
    background_opacity: float = Field(default=1.0, ge=0, le=1)
    border_color: str = Field(default="#ffffff", max_length=9)
    thick_border: bool = False
    text_color: str = Field(default="#111827", max_length=9)
    font_size: int = Field(default=14, ge=8, le=72)
    hide_closer_than: float | None = Field(default=None, ge=0)
    hide_farther_than: float | None = Field(default=None, ge=0)
    box_shape: AnnotationBoxShape = "rounded"
    leader_offset_x: float = 2.0
    leader_offset_y: float = 0.0
    leader_offset_z: float = 0.0
    leader_visible: bool = True
    animate: bool = False
    animation_loop: bool = False
    leader_dot_radius: float = Field(default=0.06, ge=0)
    leader_color: str = Field(default="#ffffff", max_length=9)
    leader_rotation: float = 0.0
    leader_scale: float = Field(default=1.0, gt=0)
    placemark_scale: float = Field(default=1.0, gt=0)
    placemark_rotation: float = 0.0


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
    background_opacity: float | None = Field(default=None, ge=0, le=1)
    border_color: str | None = Field(default=None, max_length=9)
    thick_border: bool | None = None
    text_color: str | None = Field(default=None, max_length=9)
    font_size: int | None = Field(default=None, ge=8, le=72)
    hide_closer_than: float | None = Field(default=None, ge=0)
    hide_farther_than: float | None = Field(default=None, ge=0)
    box_shape: AnnotationBoxShape | None = None
    leader_offset_x: float | None = None
    leader_offset_y: float | None = None
    leader_offset_z: float | None = None
    leader_visible: bool | None = None
    animate: bool | None = None
    animation_loop: bool | None = None
    leader_dot_radius: float | None = Field(default=None, ge=0)
    leader_color: str | None = Field(default=None, max_length=9)
    leader_rotation: float | None = None
    leader_scale: float | None = Field(default=None, gt=0)
    placemark_scale: float | None = Field(default=None, gt=0)
    placemark_rotation: float | None = None


class AnnotationResponse(AnnotationBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
