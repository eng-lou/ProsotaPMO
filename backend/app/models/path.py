from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Path(Base, TimestampMixin):
    """A reusable 3D curve (2026-07-11, per Maro: "in blender you can add a
    curve, edit it and set a path from point a to be... i can then place an
    object to follow that path") — Blender's own Curve object, scoped down
    to what this app actually needs: an ordered list of control points a
    PathFollower (path_follower.py) interpolates a smooth position along,
    nothing else. Project-scoped, not tied to any one Model3DFile — unlike
    SectionBox (bounds meaningful only in one target's own local space), a
    path is placed directly in world space and is meant to be reusable
    across whatever's bound to it (the camera, one element, or several).

    points is a JSONB array of {x, y, z} objects, not a separate child
    table — same "one opaque JSONB blob, shape owned by the frontend"
    convention as MaterialPreset's own config (see material_preset.py),
    chosen for the same reason: this is always read/written as one whole
    list (add/remove/drag a point rewrites the array wholesale from the
    frontend's own PathGizmo), never queried per-point.

    visible is this path's own live-viewport helper visibility (the curve
    line + control-point handles) — independent of whether it's actually
    hidden in a given capture/export, which is a *rendering-time* decision
    (Viewport3D.tsx forces every path helper invisible right before
    capturing, then reverts, same pattern already used for the HDR
    background override) rather than a persisted project setting; visible
    here is "do I want to see/edit this path's shape right now," matching
    SectionBox's own identical visible/active split."""

    __tablename__ = "paths"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="Path")
    points: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Cyclic U (2026-07-11) — Blender's own term for a curve that loops back
    # to its first point instead of ending at its last one.
    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
