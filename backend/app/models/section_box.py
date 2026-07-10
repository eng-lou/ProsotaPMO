from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SectionBox(Base, TimestampMixin):
    """A draggable clipping box scoped to one imported model or one of its
    IFC elements — replicates Blender's "Section Box" plugin (2026-07-09,
    per Maro, walked through via screenshots): push any of its 6 faces
    inward to slice geometry at that plane, independently per face (an
    asymmetric cutaway, not a symmetric bounding crop).

    model3d_file_id is a real FK with ON DELETE CASCADE — deliberately NOT
    the loose (source_kind, element_ref) string identity ModelElementLink/
    ElementKeyframe use (see model_element_link.py's own docstring). Those
    tables protect real scheduling work, worth preserving across a re-
    import under a new file id; a section box takes seconds to redraw, and
    a loose filename-based identity here would risk silently reattaching a
    box's old bounds to a *revised* re-import with different geometry,
    producing a visually wrong cut — a correctness risk that doesn't really
    apply to a link. The FK also means deleting the underlying Model3DFile
    (Unload) cleans up its section boxes automatically, zero orphans by
    construction — no confirm-dialog needed the way FourD.tsx's
    requestUnloadModel needs one for links/keyframes.

    element_ref is an IFC element's GlobalId for an element-scoped box, or
    null for a whole-file box (the whole IFC model, or a whole mesh import
    — mesh-kind has no sub-element concept, same whole-object-only scoping
    ModelElementLink already uses for source_kind="mesh").

    min_x/y/z, max_x/y/z are in the TARGET's own LOCAL space, not world
    space — this app already lets a whole model or an individual element be
    repositioned/rotated/rescaled via TransformControls; world-space bounds
    would leave a box visually detached from its geometry the moment the
    target moves, whereas local-space bounds move/rotate/scale with the
    target automatically, same as its geometry does. No rotation of the box
    itself in v1 — axis-aligned only, matching the Blender reference.

    active toggles whether the clip is currently applied; visible toggles
    whether the wireframe gizmo itself is shown — independent, matching the
    reference's own checkbox-vs-eye-icon distinction (you can hide the box
    chrome while still cutting, or show the box without cutting)."""

    __tablename__ = "section_boxes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    model3d_file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model3d_files.id", ondelete="CASCADE"), nullable=False
    )
    element_ref: Mapped[str | None] = mapped_column(String(300), nullable=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="Section Box")
    min_x: Mapped[float] = mapped_column(Float, nullable=False)
    min_y: Mapped[float] = mapped_column(Float, nullable=False)
    min_z: Mapped[float] = mapped_column(Float, nullable=False)
    max_x: Mapped[float] = mapped_column(Float, nullable=False)
    max_y: Mapped[float] = mapped_column(Float, nullable=False)
    max_z: Mapped[float] = mapped_column(Float, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
