from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CollectionMember(Base, TimestampMixin):
    """One element's membership in one Collection (2026-07-11). Same loose
    (source_kind, element_ref) identity as ModelElementLink
    (app/models/model_element_link.py) — deliberately not an FK to
    Model3DFile, for the same reason: an element only exists as a
    re-derivable string each time its source file loads, so membership
    survives re-imports and never cascades off a file being unloaded.
    Collections need to span elements from *multiple* imported files, so
    there's no single file to hang a hard FK off either way (contrast
    SectionBox, app/models/section_box.py, which is deliberately scoped to
    one file and so can afford a real FK).

    Unique per (collection_id, source_kind, element_ref) — dedup is scoped
    to *this* collection only. The same element can belong to any number of
    different collections at once (Blender's own behaviour); there is
    deliberately no global uniqueness constraint on element_ref alone."""

    __tablename__ = "collection_members"
    __table_args__ = (
        UniqueConstraint("collection_id", "source_kind", "element_ref", name="uq_collection_members_collection_element"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collection_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("collections.id", ondelete="CASCADE"), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "ifc" | "mesh"
    element_ref: Mapped[str] = mapped_column(String(300), nullable=False)
    element_label: Mapped[str] = mapped_column(String(300), nullable=False)
