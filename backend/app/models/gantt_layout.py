from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# Mirrors frontend/src/lib/ganttLayout.ts's GanttStyle shape — colours are hex
# strings, applied as CSS custom properties/inline styles rather than fixed
# Tailwind classes so a project can actually override them (see
# GanttChart.tsx/GanttLegend.tsx). These are also the new hardcoded defaults
# Maro asked for (2026-07-03): red/blue bars unchanged, but WBS summary is now
# a dark-grey jagged bar (not a bar fill at all — see the frontend renderer),
# milestones match their bar's critical/non-critical colour instead of purple,
# and baseline is yellow and thicker.
DEFAULT_STYLE = {
    "critical_color": "#ef4444",
    "non_critical_color": "#3b82f6",
    "milestone_critical_color": "#ef4444",
    "milestone_noncritical_color": "#3b82f6",
    "baseline_color": "#eab308",
    "baseline_thickness": 7,
    "table_font_color": "#111827",
    "table_font_family": "sans",
    # Row background tints in the activity table (2026-07-03, per Maro — a
    # second thought after first asking for bold/uppercase WBS rows: a shade
    # reads better and generalises to activity/milestone rows too). Critical-
    # path rows still take visual priority over these (existing behaviour),
    # tinted with critical_color above rather than a separate field.
    # wbs_level_colors: one colour per WBS nesting depth (up to 6+, see
    # app/schemas/gantt_layout.py:DEFAULT_WBS_LEVEL_COLORS) — both the Gantt's
    # jagged summary line and the table row shade at that depth draw from it.
    "wbs_level_colors": ["#374151", "#4b5563", "#6b7280", "#9ca3af", "#94a3b8", "#cbd5e1"],
    "activity_row_color": "#ffffff",
    "milestone_row_color": "#a855f7",
}


class GanttLayout(Base, TimestampMixin):
    """A named, saved visual theme for Scheduling (2026-07-03, per Maro) —
    Gantt colours/baseline thickness/table font, bundled with a snapshot of
    the project's letterhead at save time. Same create-then-apply shape as
    ScheduleBaseline: creating doesn't change anything live; applying (1)
    flips is_active, clearing any other layout for this project, and (2)
    pushes letterhead_snapshot into the live ProjectLetterhead row, so a
    layout is a single "look" a project can switch between rather than two
    independently-versioned things.

    style/letterhead_snapshot are JSONB, not flat columns, for the same
    reason as ProjectLetterhead's own header_zones/footer_zones — this is
    always read/written as one unit, and a flat schema would need a dozen+
    columns for a blob that changes shape as new style knobs get added."""

    __tablename__ = "gantt_layouts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    style: Mapped[dict] = mapped_column(JSONB, nullable=False, default=lambda: dict(DEFAULT_STYLE))
    letterhead_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
