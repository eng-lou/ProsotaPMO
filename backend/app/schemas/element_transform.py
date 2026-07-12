from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TransformValues(BaseModel):
    position_x: float = 0.0
    position_y: float = 0.0
    position_z: float = 0.0
    rotation_x: float = 0.0
    rotation_y: float = 0.0
    rotation_z: float = 0.0
    scale_x: float = 1.0
    scale_y: float = 1.0
    scale_z: float = 1.0
    # "Set Pivot" (2026-07-12) — null means "use the source file's own
    # original origin." Always sent together (all three or none) by the
    # frontend, which carries the current value forward on every save
    # (position/rotation/scale edits included) rather than this schema
    # trying to distinguish "not provided" from "explicitly cleared" —
    # see FourD.tsx's own save-transform handler.
    pivot_x: float | None = None
    pivot_y: float | None = None
    pivot_z: float | None = None


# One request shape, upserted server-side (see service's save_transform) --
# the caller never needs to know whether a row already exists for this
# (model3d_file_id, element_ref) pair.
class ElementTransformSave(TransformValues):
    model3d_file_id: uuid.UUID
    element_ref: str | None = None


class ElementTransformResponse(TransformValues):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    model3d_file_id: uuid.UUID
    element_ref: str | None
    created_at: datetime
    updated_at: datetime
