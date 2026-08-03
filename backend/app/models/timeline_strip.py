from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class TimelineStrip(Base, TimestampMixin):
    """A single, project-wide horizontal year/month timeline HUD strip for
    the 4D viewport (2026-08-03, per Maro's own Synchro-style reference
    screenshot — bracketed year labels over single-letter month ticks, with
    a highlighted playhead box over the active month). Same screen-space
    HUD spirit as RadialChart (radial_chart.py) — not a 3D-world object,
    position saved as percent-of-viewport for output-resolution
    independence — but a genuine singleton: one row per project
    (project_id unique), same "one row per project, get-or-default,
    upsert" shape as ProjectLetterhead (project_letterhead.py), not
    RadialChart's own creatable-list CRUD. There's no natural "create
    another one" the way there is for a per-discipline progress ring — a
    project only ever has one timeline.

    width_px/height_px are a genuinely fixed size, dragged into position
    (not resized by dragging a viewport edge) — width does NOT stretch to
    fill the viewport; the strip always shows its full scoped date range
    compressed into that fixed width, exactly like the reference
    screenshot's own fixed-width multi-year compressed view.

    Date domain is never stored here — like RadialChart's progress, it's
    computed live client-side (computeScheduleRange over whichever
    Activities match this row's own scope filter — see
    frontend/timelinePlayback.ts and scheduleScope.ts), so it always
    reflects the real current schedule with no separate sync step.

    scope_mode/udf_field_definition_id/udf_value/wbs_node_activity_id are
    the exact same shape as RadialChart's own scope fields (see that
    model's own docstring) — shared concept, two independent rows."""

    __tablename__ = "timeline_strips"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    position_x_pct: Mapped[float] = mapped_column(Float, nullable=False, default=10.0)
    position_y_pct: Mapped[float] = mapped_column(Float, nullable=False, default=90.0)
    width_px: Mapped[float] = mapped_column(Float, nullable=False, default=900.0)
    height_px: Mapped[float] = mapped_column(Float, nullable=False, default=56.0)
    background_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#1f2937")
    band_border_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#ffffff")
    text_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#ffffff")
    playhead_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#ef4444")
    font_size: Mapped[float] = mapped_column(Float, nullable=False, default=11.0)
    scope_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="all")
    udf_field_definition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_defined_field_definitions.id", ondelete="SET NULL"), nullable=True
    )
    udf_value: Mapped[str | None] = mapped_column(String(500), nullable=True)
    wbs_node_activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="SET NULL"), nullable=True
    )
