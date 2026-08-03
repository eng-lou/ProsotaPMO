from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Camera(Base, TimestampMixin):
    """A named, keyframeable cinematic camera in the 4D viewport (2026-08-03,
    per Maro: "thinking of a preview of the camera passepartout like in
    blender... add separate cameras and play the animation and see the
    transitions") — distinct from CameraView (camera_view.py), which is a
    one-shot "jump to this pose" bookmark with no lens settings and no
    binding to the animation timeline.

    This row only ever holds a Camera's *base* pose/lens — the values used
    whenever a given field has no ElementKeyframe of its own yet, exactly
    mirroring how an animated mesh object falls back to its own base
    transform when a keyframe track is empty (see element_keyframe.py).
    Position/target/focal length/clip start/end over time are NOT columns
    here — they're ElementKeyframe rows with source_kind="camera" and
    element_ref=str(camera.id), reusing that generic per-field/per-date
    scalar keyframe store (and its existing linear-interpolation playback)
    instead of inventing a second keyframe system.

    Aims via a look-at target point (position_x/y/z + target_x/y/z), same
    convention CameraView already uses — simpler to keyframe smoothly than
    full 6DOF rotation, at the cost of not supporting independent camera
    roll (confirmed acceptable with Maro for v1).

    focal_length is stored in millimetres against an assumed 36mm
    full-frame sensor width (Blender's own default), converted to the live
    THREE.PerspectiveCamera's fov at render time — see frontend's
    fovFromFocalLength() in cameras.ts. Lens shift (Shift X/Y) is
    deliberately out of scope for v1 (confirmed with Maro) — a specialized
    architectural tilt-shift correction, rarely animated.
    """

    __tablename__ = "cameras"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="Camera")
    base_position_x: Mapped[float] = mapped_column(Float, nullable=False)
    base_position_y: Mapped[float] = mapped_column(Float, nullable=False)
    base_position_z: Mapped[float] = mapped_column(Float, nullable=False)
    base_target_x: Mapped[float] = mapped_column(Float, nullable=False)
    base_target_y: Mapped[float] = mapped_column(Float, nullable=False)
    base_target_z: Mapped[float] = mapped_column(Float, nullable=False)
    # Millimetres, Blender-style (36mm full-frame sensor assumed) — see
    # this class's own docstring on why this isn't stored as raw fov.
    base_focal_length: Mapped[float] = mapped_column(Float, nullable=False, default=50.0)
    base_clip_start: Mapped[float] = mapped_column(Float, nullable=False, default=0.1)
    base_clip_end: Mapped[float] = mapped_column(Float, nullable=False, default=10000.0)
