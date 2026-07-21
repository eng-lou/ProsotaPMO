from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# One entry per existing Overview panel, x/y/w/h chosen to reproduce today's
# fixed 2-column arrangement on a 12-column grid — nothing visually changes
# until Maro actually rearranges something (2026-07-20, per Maro: "think
# powerbi" — dockable/resizable/repositionable dashboard widgets).
DEFAULT_CONFIG = {
    "widgets": [
        {"id": "kpi_strip", "widget_type": "kpi_strip", "x": 0, "y": 0, "w": 12, "h": 2},
        {"id": "schedule_performance", "widget_type": "schedule_performance", "x": 0, "y": 2, "w": 6, "h": 4},
        {"id": "risk_overview", "widget_type": "risk_overview", "x": 6, "y": 2, "w": 6, "h": 4},
        {"id": "milestone_timeline", "widget_type": "milestone_timeline", "x": 0, "y": 6, "w": 6, "h": 4},
        {"id": "risk_exposure", "widget_type": "risk_exposure", "x": 6, "y": 6, "w": 6, "h": 4},
        {"id": "top_risks", "widget_type": "top_risks", "x": 0, "y": 10, "w": 12, "h": 5},
    ]
}


class DashboardLayout(Base, TimestampMixin):
    """A named, saved Controls Dashboard widget arrangement — mirrors
    DockLayout's own create-then-apply shape exactly (app/models/
    dock_layout.py): creating a layout snapshots the current arrangement
    without changing anything live; applying flips is_active, clearing any
    other layout for this project, and is what actually makes the frontend
    grid re-render with that arrangement. At most one active layout per
    project.

    config is JSONB, not flat columns, for the same reason as DockLayout's
    own config — read/written as one unit, and its shape (which widgets,
    their grid x/y/w/h) is the frontend grid's own concern, not this
    table's. x/y/w/h use the exact units react-grid-layout itself consumes
    (grid columns/rows), deliberately no translation layer between what's
    stored and what the grid library renders."""

    __tablename__ = "dashboard_layouts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=lambda: dict(DEFAULT_CONFIG))
