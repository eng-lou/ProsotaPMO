from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ElementTransform(Base, TimestampMixin):
    """Persists a manual position/rotation/scale edit made via the gizmo or
    the Properties panel's Transform fields (2026-07-11) — confirmed, via a
    real incident, that this had never been persisted anywhere: no DB
    column existed for it and no update endpoint did either, so every
    manual repositioning of a model (or an individual IFC sub-element —
    federated/assembly alignment work in particular) was silently thrown
    away the moment the page reloaded and the raw file got re-loaded from
    scratch.

    Same model3d_file_id-FK + optional element_ref pattern as SectionBox
    (section_box.py) — not ModelElementLink's loose string identity, for
    the identical reason: a transform is meaningless once its target file
    is deleted/replaced (see model3d_file.py's create_file — re-importing a
    file under the same name now deletes the old row, cascading this
    table too, which is correct: a revised re-import may have a completely
    different origin/scale, so an old transform silently carrying over
    would be actively wrong, not just orphaned).

    element_ref is null for a whole-file transform (the entire imported
    model or mesh moved/rotated/scaled as one unit) or an IFC GlobalId for
    one specific sub-element repositioned independently of its parent
    model. Unique per (model3d_file_id, element_ref) — there is only ever
    one "current" transform for a given target, upserted on every edit
    rather than versioned.

    position/rotation/scale are the object's own *local*-space values
    (object.position/.rotation/.scale straight off the THREE.Object3D,
    same convention SectionBox's bounds already use) — not world space,
    so they stay correct regardless of the axis-correction wrapper group
    Viewport3D.tsx applies around every imported object. rotation is
    stored in radians, using THREE.Euler's default 'XYZ' order (nothing in
    this codebase ever changes that order elsewhere).

    pivot_x/y/z (2026-07-12, per Maro's crane-rigging request — see
    elementPivot.ts's own header) are a *local*-space offset marking where
    this element's own rotation/scale origin has been moved to, via
    "Set Pivot" — null (all three, always together) means "use the
    source file's own original origin," the default for everything
    imported before this feature existed. Deliberately not folded into a
    generic JSON blob: every other field on this row is a plain typed
    float for the same (model3d_file_id, element_ref) target, and pivot
    is exactly that same shape, just consumed differently client-side
    (an offset applied once at restore time, before position/rotation/
    scale, rather than set directly on the object every frame)."""

    __tablename__ = "element_transforms"
    __table_args__ = (
        UniqueConstraint("model3d_file_id", "element_ref", name="uq_element_transforms_file_element"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    model3d_file_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("model3d_files.id", ondelete="CASCADE"), nullable=False, index=True)
    element_ref: Mapped[str | None] = mapped_column(String(300), nullable=True)

    position_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    position_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    position_z: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    rotation_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    rotation_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    rotation_z: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    scale_x: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    scale_y: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    scale_z: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    pivot_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    pivot_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    pivot_z: Mapped[float | None] = mapped_column(Float, nullable=True)
