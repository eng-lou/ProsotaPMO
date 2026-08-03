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
#
# visible (2026-07-12, per Maro's Annotation reference — "keyframe if i
# want") — 0/1, whether an Annotation (annotation.py) is showing at a given
# date. Only ever written for source_kind="annotation"; ordinary mesh/ifc
# targets have no use for it (their own visibility is driven by an assigned
# AnimationProfile's opacity, not a manual on/off keyframe).
# anim_start/anim_end (2026-07-30, per Maro: "this segment needs to work
# independent of [a scheduled Activity]... if i keyframe i should see the
# path actor in the timeline with both keyframes so i can drag, delete
# etc") — Path/Zone's own line-draw/border-draw reveal window, reusing this
# exact date-keyed shape instead of the plain animation_start/animation_end
# datetime columns this replaced: a keyframe's own `date` *is* the
# start/end instant (value is unused, always 0), which is what makes the
# reveal's own timing show up as draggable/deletable diamonds in
# AnimationActorsList.tsx's dope sheet for free, and what makes
# computeKeyframeRange (timelinePlayback.ts) — already unioned with the
# schedule range for exactly this "no Activity required" reason — extend
# the scrubbable range the moment either one is keyed, with zero extra code.
#
# target_x/y/z, focal_length, clip_start, clip_end (2026-08-03, per Maro:
# "add separate cameras... keyframe the positions of this camera") — the
# new named Camera entity (camera.py), always source_kind="camera" with
# element_ref=str(camera.id) (NOT the "" sentinel — see source_kind's own
# comment below on the pre-existing, unrelated "camera follows a path"
# usage). pos_x/y/z is reused as-is for a Camera's own position; target_x/
# y/z is its look-at point (same convention CameraView already uses);
# focal_length/clip_start/clip_end are its lens settings. Falls back to
# the owning Camera row's own base_* column whenever a given field has no
# keyframe yet, same "base value until overridden" convention every other
# animated target already uses.
KeyframeField = Literal[
    "pos_x", "pos_y", "pos_z", "rot_x", "rot_y", "rot_z", "scale_x", "scale_y", "scale_z", "path_progress", "visible",
    "anim_start", "anim_end", "target_x", "target_y", "target_z", "focal_length", "clip_start", "clip_end",
]


class ElementKeyframeUpsert(BaseModel):
    project_id: uuid.UUID
    # "camera" (2026-07-11) — the first ElementKeyframe target that isn't a
    # mesh/IFC element at all. Two distinct uses share this source_kind,
    # told apart by element_ref:
    #  - element_ref="" (2026-07-11) — the *main viewport's own* orbit
    #    camera, only ever for field="path_progress" (PathFollower's
    #    target_kind="camera"), same empty-string-not-null convention
    #    PathFollower's own docstring explains.
    #  - element_ref=str(camera.id) (2026-08-03) — a specific named Camera
    #    (camera.py), for pos_x/y/z/target_x/y/z/focal_length/clip_start/
    #    clip_end — see KeyframeField's own comment above.
    # "annotation" (2026-07-12) — element_ref is the Annotation row's own id
    # (annotation.py), for pos_x/y/z and visible keyframes on a Placemark/
    # Comment, plus (2026-08-06) field="anim_start"/"anim_end" for its own
    # whole-annotation reveal window — see annotation.py's own
    # animate/animation_loop header.
    # "path"/"zone" (2026-07-30) — element_ref is the Path/Zone row's own id
    # (path.py/zone.py), used only for field="anim_start"/"anim_end" — see
    # KeyframeField's own header just above.
    source_kind: Literal["ifc", "mesh", "camera", "annotation", "path", "zone"]
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
