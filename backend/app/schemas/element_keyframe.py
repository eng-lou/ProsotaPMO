from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

KeyframeField = Literal["pos_x", "pos_y", "pos_z", "rot_x", "rot_y", "rot_z", "scale_x", "scale_y", "scale_z"]


class ElementKeyframeUpsert(BaseModel):
    project_id: uuid.UUID
    source_kind: Literal["ifc", "mesh"]
    element_ref: str
    field: KeyframeField
    date: datetime
    value: float


class ElementKeyframeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    source_kind: str
    element_ref: str
    field: str
    date: datetime
    value: float
    created_at: datetime
    updated_at: datetime
