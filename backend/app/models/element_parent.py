from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ElementParent(Base, TimestampMixin):
    """Rigs one mesh-kind imported object as the child of another (2026-07-12,
    per Maro's crane-rigging request — base -> jib -> trolley -> hook) —
    Blender's own pivot-based parenting (Ctrl+P), not bones/IK: real
    three.js scene-graph nesting, so animating the parent's transform
    carries the child along via ordinary matrixWorld composition, with zero
    changes needed to how Mode A/B already write a target's local
    position/rotation/scale (see elementRigging.ts's own header).

    Mesh-kind only in v1 (child_element_ref/parent_element_ref are both
    imported-file filenames, same identity mesh-kind PathFollower/
    ModelElementLink targets already use) — matches how rig parts are
    actually authored as separate GLB/OBJ files, and mirrors
    PathFollower's own "camera binding is a later pass" incremental
    scoping (path_follower.py's own docstring); not an architectural dead
    end if IFC whole-model parenting is ever wanted later.

    One parent per child (UniqueConstraint below), same shape as
    PathFollower's own "one binding per target at a time" — a child
    re-parented to a different object re-points this row rather than
    adding a second, conflicting parent (see element_parent.py service's
    own upsert_element_parent). Self-parenting and cycles (A parent of B
    parent of A) are rejected at the service layer, not expressible via
    this table's own constraints alone."""

    __tablename__ = "element_parents"
    __table_args__ = (
        UniqueConstraint("project_id", "child_element_ref", name="uq_element_parents_child"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    child_element_ref: Mapped[str] = mapped_column(String(300), nullable=False)
    parent_element_ref: Mapped[str] = mapped_column(String(300), nullable=False)
