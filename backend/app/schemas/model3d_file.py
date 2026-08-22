from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Model3DKind = Literal["ifc", "mesh"]
UpAxis = Literal["y", "z"]


# "Unload Selected" (2026-07-26, per Maro) — see Model3DFile.unloaded_elements'
# own docstring for the full "why GlobalId, not expressID" story. name/
# type_name are captured once, at unload time (ifcModel.ts's own
# getElementName/getElementTypeName, using the still-open web-ifc handle),
# so the "Reload IFC" picker can show a real, readable list without ever
# needing to re-parse the file just to look them up again.
class UnloadedElementInfo(BaseModel):
    guid: str
    name: str
    type_name: str


class Model3DFileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    kind: Model3DKind
    source_up_axis: UpAxis
    size_bytes: int
    created_at: datetime
    updated_at: datetime
    # Nullable at the DB layer (a fresh import has never had anything
    # unloaded yet) — left as None here to match, rather than defaulting to
    # [] and hiding that distinction; model3dFiles.ts's own frontend type
    # coalesces this to [] at the one call site that reads it.
    unloaded_elements: list[UnloadedElementInfo] | None = None
    # See Model3DFile.keep_raw_animation's own docstring — True only for a
    # particle/multi-node-style embedded animation this app can never
    # convert to schedule keyframes, so the restore-on-mount path knows to
    # keep it raw (played back by Viewport3D.tsx's EmbeddedAnimationLoop)
    # instead of stripping it the way an already-baked import's animation
    # correctly gets stripped on every reload.
    keep_raw_animation: bool = False


class Model3DFileUnloadedElementsUpdate(BaseModel):
    unloaded_elements: list[UnloadedElementInfo]
