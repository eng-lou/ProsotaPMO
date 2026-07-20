from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MeasurementKind = Literal["length", "area"]


class MeasurementPoint(BaseModel):
    x: float
    y: float
    z: float


class MeasurementBase(BaseModel):
    name: str = Field(default="Measurement", min_length=1, max_length=300)
    kind: MeasurementKind
    points: list[MeasurementPoint]
    # Every other closed boundary loop inside a face-clicked patch — real
    # openings cut into it, drawn but not counted (see measurement.py's own
    # docstring). Always empty for a manually points-clicked area or a
    # length.
    hole_loops: list[list[MeasurementPoint]] = Field(default_factory=list)
    value: float = Field(ge=0)
    visible: bool = True

    # A length that isn't exactly 2 points, or an area with fewer than 3,
    # isn't a different shape of measurement — it's not a valid one at all
    # (mirrors the "material has no sensible default utilisation" style
    # cross-field check schedule_bulk_generate.py's own service already
    # does, just simple enough to belong on the schema directly instead).
    @model_validator(mode="after")
    def _check_point_count(self) -> "MeasurementBase":
        if self.kind == "length" and len(self.points) != 2:
            raise ValueError("A length measurement needs exactly 2 points")
        if self.kind == "area" and len(self.points) < 3:
            raise ValueError("An area measurement needs at least 3 points")
        return self


class MeasurementCreate(MeasurementBase):
    project_id: uuid.UUID


class MeasurementUpdate(BaseModel):
    # points/kind/value are deliberately not patchable — unlike a Path's
    # points (meant to be dragged/edited indefinitely), a Measurement is a
    # fixed record of "this was X long/wide when I took it"; allowing
    # points to change without also being forced to recompute value would
    # open exactly the stale-derived-value bug class this app has hit
    # before (see Activity.schedule_quantity's own docstring). Delete and
    # re-measure instead.
    name: str | None = Field(default=None, min_length=1, max_length=300)
    visible: bool | None = None


class MeasurementResponse(MeasurementBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
