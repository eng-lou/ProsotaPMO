from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ElementSplit(Base, TimestampMixin):
    """A tall element modeled as one continuous piece across several storeys
    (2026-07-15, per Maro: a vertical wall/shaft spanning multiple levels
    "seems unreasonable in the construction process unless it's a prefab
    installation") — this row records that one element should instead be
    rendered/linked as several independent per-level slices.

    Deliberately NOT a real geometry split: this table only ever stores
    which elevations to cut at, in metres, already converted from the IFC
    file's own declared unit (see ifcModel.ts's getLengthUnitToMetres) so
    nothing server-side needs to know a file's unit system. The actual
    slices are generated client-side every time the model loads, as
    clipped clones of the one real mesh (frontend/src/modules/fourD/
    elementSplitTargets.ts) — no derived geometry is ever produced or
    stored here, matching how ModelElementLink/CollectionMember also never
    persist anything about the model file itself, just a loose
    (source_kind, element_ref) identity re-derived on each load.

    One row per split *element*, not per cut — cut_elevations_m holds the
    whole sorted list, so re-splitting the same element (add/remove a cut)
    is a single update rather than juggling N child rows.

    source_kind is "ifc" only for now (a plain mesh import has no storey/
    elevation concept to split against) but kept as its own column rather
    than hardcoded, matching every other element-identity table in this
    codebase (ModelElementLink, CollectionMember) in case that ever
    changes."""

    __tablename__ = "element_splits"
    __table_args__ = (
        UniqueConstraint("project_id", "source_kind", "element_ref", name="uq_element_splits_project_element"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "ifc"
    element_ref: Mapped[str] = mapped_column(String(300), nullable=False)
    cut_elevations_m: Mapped[list[float]] = mapped_column(JSONB, nullable=False)
