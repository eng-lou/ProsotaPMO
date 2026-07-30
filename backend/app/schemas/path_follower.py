from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

PathFollowerTargetKind = Literal["camera", "mesh", "ifc"]


class PathFollowerBase(BaseModel):
    path_id: uuid.UUID
    target_kind: PathFollowerTargetKind
    # "" (never None) for target_kind="camera" — see the model's own
    # docstring on why NULL specifically would have been wrong here.
    element_ref: str = ""
    orient_to_path: bool = True
    # See path_follower.py's own model docstring — compensates for an
    # imported model's own authored forward axis not matching three.js's
    # lookAt convention (local -Z).
    heading_offset_deg: float = 0.0


class PathFollowerCreate(PathFollowerBase):
    project_id: uuid.UUID


class PathFollowerUpdate(BaseModel):
    path_id: uuid.UUID | None = None
    orient_to_path: bool | None = None
    heading_offset_deg: float | None = None


class PathFollowerResponse(PathFollowerBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
