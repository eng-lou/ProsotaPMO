from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SchedulingFilter(Base, TimestampMixin):
    """A named, saved custom activity-table filter (2026-07-05, per Maro,
    modelled directly on P6's own Filters dialog: a "Global" tier of built-in
    presets — Critical/Delayed/At Risk, still hardcoded in Scheduling.tsx, not
    stored here — plus a "User Defined" tier of these. Each filter is a list
    of conditions (field/operator/value) plus its own match_mode ("all"/"any")
    for combining them; a *separate*, global "match All selected filters/Any
    selected filter" toggle (not stored server-side, just a UI preference)
    then combines whichever filters — built-in and custom — are currently
    enabled. No "apply"/is_active concept like GanttLayout: multiple filters
    can be enabled simultaneously, so this is plain CRUD.

    conditions is JSONB, not flat columns, for the same reason as GanttLayout's
    style column — an open-ended list of {field, operator, value} entries."""

    __tablename__ = "scheduling_filters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    match_mode: Mapped[str] = mapped_column(String(3), nullable=False, default="all")
    conditions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
