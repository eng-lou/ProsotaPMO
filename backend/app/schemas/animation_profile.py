from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# Mirrors frontend/src/modules/fourD/animationProfiles.ts's
# AnimationProfileConfig exactly. The named presets a user picks from
# ("Pop Up Y", "Fall Down Z", "Spiral In X", "Rotate In Bounce -Z", ...) all
# reduce to this same parameter set — matching the reference Blender add-on's
# own field layout (axis + direction/distance + bounce/twist toggles) — so
# adding a new preset is a frontend constant, not a schema change.
class AnimationProfileConfig(BaseModel):
    # When the animation plays relative to the linked Activity's dates —
    # "over_duration" fades/grows across the whole task (new construction,
    # the common case); "on_start"/"on_finish" flip instantly at one date
    # (e.g. Maro's "remove site office" example: red while ongoing, then
    # gone — the disappearance itself is instant at finish, only the colour
    # persists across the duration).
    trigger: Literal["on_start", "on_finish", "over_duration"] = "over_duration"

    # "grow" (2026-07-30, per Maro's own concrete-slab reference video —
    # "how it forms from the right to the left") — a moving world-space
    # clip plane (frontend's own Viewport3D.tsx useFrame, growClipPlane),
    # not a transform/opacity effect like every other kind here; still
    # validated the same way since config is otherwise opaque JSONB (this
    # class's own header) and the frontend's own AnimationProfileConfig
    # TransformKind union is the actual source of truth for the full set.
    transform_kind: Literal["none", "translate", "scale", "rotate", "pop", "spiral", "fall", "grow"] = "none"
    axis: Literal["x", "y", "z"] = "z"
    direction: Literal[1, -1] = 1
    distance: float = 1.0
    bounce: bool = False
    twist: bool = False

    # Material transition (2026-07-11, per Maro: "1 to 0 on the base
    # material will look like its going transparent") — opacity_from/to are
    # the element's state at the *start* of this profile's animation window
    # vs its end; color_from/to are optional (None = don't touch colour,
    # e.g. "red while ongoing" is color_from=color_to="#ef4444" — same
    # colour both ends, just held for the duration).
    opacity_from: float = Field(default=0.0, ge=0, le=1)
    opacity_to: float = Field(default=1.0, ge=0, le=1)
    color_from: str | None = None
    color_to: str | None = None

    interpolation: Literal["linear", "ease_in", "ease_out", "ease_in_out", "bounce"] = "linear"
    # None = derive from the linked Activity's own duration via the
    # timeline's speed setting; set to force a fixed length regardless of
    # task duration (e.g. a quick 12-frame "pop" even on a 30-day task).
    duration_frames: float | None = None


class AnimationProfileCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    config: AnimationProfileConfig = AnimationProfileConfig()


class AnimationProfileUpdate(BaseModel):
    name: str
    config: AnimationProfileConfig = AnimationProfileConfig()


class AnimationProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    config: AnimationProfileConfig
    created_at: datetime
    updated_at: datetime
