from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

# path_progress (2026-07-11, per Maro: "i can then place an object to
# follow that path... independent manual progress, not tied to dates") —
# 0-100, how far along its bound Path (path.py/path_follower.py) the
# target currently is. Reuses this exact same date-keyed field shape
# rather than a new value store, since "one more field on a target,
# interpolated between keyframed dates" is structurally identical to
# pos_x/rot_x/etc — only Viewport3D.tsx's own per-frame application differs
# (a path_progress value feeds a curve lookup instead of being written
# straight onto object.position/rotation).
KeyframeField = Literal[
    "pos_x", "pos_y", "pos_z", "rot_x", "rot_y", "rot_z", "scale_x", "scale_y", "scale_z", "path_progress",
]


class ElementKeyframeUpsert(BaseModel):
    project_id: uuid.UUID
    # "camera" (2026-07-11) — the first ElementKeyframe target that isn't a
    # mesh/IFC element at all, for keyframing path_progress (or someday
    # position directly) on the viewport's own camera, which finally has a
    # first-class identity via PathFollower's target_kind. element_ref is
    # "" for a camera row, same empty-string-not-null convention
    # PathFollower's own docstring explains.
    source_kind: Literal["ifc", "mesh", "camera"]
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
