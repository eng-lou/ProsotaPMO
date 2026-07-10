from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
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
    just repositions the existing camera, it doesn't change the lens."""

    __tablename__ = "camera_views"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="Camera View")
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)
    position_z: Mapped[float] = mapped_column(Float, nullable=False)
    target_x: Mapped[float] = mapped_column(Float, nullable=False)
    target_y: Mapped[float] = mapped_column(Float, nullable=False)
    target_z: Mapped[float] = mapped_column(Float, nullable=False)
