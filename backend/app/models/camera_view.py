from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CameraView(Base, TimestampMixin):
    """A saved camera viewpoint in the 4D viewport (2026-07-10, per Maro:
    "add camera too so i can capture the model at different angles like
    blender") — Blender's own numbered-viewpoint bookmarks, translated to
    this app's orbit-camera model: position (where the camera itself
    sits) plus target (the OrbitControls point it's looking at/orbiting
    around), both in world space. Project-scoped and persisted server-side
    like everything else built this session (Section Box, Model3DFile) —
    not a per-browser localStorage convenience, since a saved shot of "the
    east elevation" or "the plant room" is exactly the kind of thing worth
    surviving a hard refresh and being usable from another machine.

    Deliberately doesn't store field of view or the viewport's global
    up-axis setting — both are viewer-wide settings (ViewerSettings),
    not part of "a viewpoint" the way position/target are; a saved view
    just repositions the existing camera, it doesn't change the lens.

    viewport_state/thumbnail_data_url (2026-07-20, per Maro: "I want it to
    capture not just orbit angle but contextual visibility as well... I
    want it to go back to exactly what it was at the time") — a saved view
    now also snapshots isolate/hidden state and whether clash colors were
    on (see schemas.camera_view.CameraViewportState's own docstring for the
    exact shape and why it's a flexible JSONB blob rather than a dozen new
    columns), plus an optional PNG thumbnail for the dashboard's non-
    interactive "Camera Views" gallery widget. The thumbnail is a base64
    data URI straight in a Text column, not disk storage — Model3DFile's
    local-disk choice was explicitly about multi-hundred-MB IFC files (see
    that model's own docstring); a viewport screenshot is a tiny PNG, the
    same scale as ProjectLetterhead.logo_data_url, which already
    establishes "small image = base64 in a column" as this codebase's own
    precedent for exactly this case. Both new fields nullable: a view saved
    before this feature existed, or via a raw API call, simply has
    neither — restoring it just does what it always did (camera pose
    only)."""

    __tablename__ = "camera_views"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="Camera View")
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)
    position_z: Mapped[float] = mapped_column(Float, nullable=False)
    target_x: Mapped[float] = mapped_column(Float, nullable=False)
    target_y: Mapped[float] = mapped_column(Float, nullable=False)
    target_z: Mapped[float] = mapped_column(Float, nullable=False)
    viewport_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    thumbnail_data_url: Mapped[str | None] = mapped_column(Text, nullable=True)
