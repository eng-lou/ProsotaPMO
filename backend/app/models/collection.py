from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Collection(Base, TimestampMixin):
    """Blender-style user-defined element grouping (2026-07-11, per Maro):
    freely group IFC sub-elements and whole mesh-kind objects together,
    independent of the IFC import's own spatial hierarchy, then select/
    hide/isolate by the group. Nested sub-collections via
    parent_collection_id, same self-referential pattern as Activity's own
    WBS outline (app/models/activity.py, parent_id) — cascades on delete
    (removing a parent removes its whole sub-collection subtree), but never
    touches the actual elements those collections reference — see
    CollectionMember's own docstring for why that's true by construction.

    sort_order is server-set at creation time only (max(sibling)+1) — no
    drag-reorder in v1, unlike Activity's own fuller
    _next_sibling_sort_order_after machinery; reparenting instead goes
    through a plain "Move to…" picker on the frontend."""

    __tablename__ = "collections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_collection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="Collection")
    sort_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
