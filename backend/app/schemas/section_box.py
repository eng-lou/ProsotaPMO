from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SectionBoxBase(BaseModel):
    model3d_file_id: uuid.UUID
    element_ref: str | None = Field(default=None, max_length=300)
    name: str = Field(default="Section Box", min_length=1, max_length=300)
    min_x: float
    min_y: float
    min_z: float
    max_x: float
    max_y: float
    max_z: float
    # Radians, THREE.Euler 'XYZ' order, applied around the box's own centre
    # — same convention ElementTransform's own rotation_x/y/z already use
    # (2026-07-17, per Maro: "I'd like to rotate the bounding box"). Default
    # 0 so a freshly-created (still axis-aligned) box needs no client-side
    # change to keep working.
    rot_x: float = Field(default=0.0)
    rot_y: float = Field(default=0.0)
    rot_z: float = Field(default=0.0)


# project_id is never client-supplied — the service derives it from the
# referenced Model3DFile's own project_id, same as ModelElementLinkCreate
# derives it from the linked Activity rather than trusting the client.
class SectionBoxCreate(SectionBoxBase):
    pass


# Everything about a section box is editable after creation — renaming,
# toggling active/visible, and (2026-07-09, per the drag gizmo) new bounds
# once a face has been dragged. Unlike ModelElementLinkUpdate (which only
# ever lets animation_profile_id change), re-targeting model3d_file_id/
# element_ref isn't offered here — that's delete-then-recreate, same
# reasoning as ModelElementLink's own re-linking convention.
class SectionBoxUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    min_x: float | None = None
    min_y: float | None = None
    min_z: float | None = None
    max_x: float | None = None
    max_y: float | None = None
    max_z: float | None = None
    rot_x: float | None = None
    rot_y: float | None = None
    rot_z: float | None = None
    active: bool | None = None
    visible: bool | None = None


class SectionBoxResponse(SectionBoxBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    active: bool
    visible: bool
    created_at: datetime
    updated_at: datetime
