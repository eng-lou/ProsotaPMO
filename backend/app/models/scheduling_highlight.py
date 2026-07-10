from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SchedulingHighlight(Base, TimestampMixin):
    """A named, saved custom activity-table row highlight (2026-07-06, per
    Maro — "works exactly like the filter", modelled directly on
    SchedulingFilter/scheduling_filters.py, same condition-builder shape.
    Differs in what enabling one *does*: a filter narrows the visible list; a
    highlight never hides anything, it just tints matching rows with the
    single project-wide GanttStyle.highlight_color (2026-07-06, per Maro:
    "allow me to set the highlight colour in the layout" — one shared colour,
    not one per rule). Multiple enabled highlights (built-in "Critical" +
    any of these) combine by union, not the filter's own configurable
    All/Any — each is independently "a reason to flag this row", so there's
    no real case for only tinting a row when every enabled highlight matches
    it at once.

    conditions is JSONB, not flat columns, for the same reason as
    SchedulingFilter's own."""

    __tablename__ = "scheduling_highlights"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    match_mode: Mapped[str] = mapped_column(String(3), nullable=False, default="all")
    conditions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
