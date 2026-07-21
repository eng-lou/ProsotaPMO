from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

DEFAULT_CONFIG = {
    "open_windows": [],
    "window_dock": {},
    "top_dock_height": 320,
    "bottom_dock_height": 320,
    "top_split_ratios": [],
    "bottom_split_ratios": [],
    "properties_open": True,
    "data_panel_open": True,
}


class DockLayout(Base, TimestampMixin):
    """A named, saved 4D window-dock arrangement (2026-07-11, per Maro: "at
    the top, allow me to save layout, edit, delete... create different
    dockable layouts sizes etc.") — mirrors GanttLayout's own create-then-
    apply shape (gantt_layout.py) exactly: creating a layout snapshots the
    current arrangement without changing anything live; applying (1) flips
    is_active, clearing any other layout for this project, and (2) is what
    actually makes FourD.tsx re-render with that arrangement. At most one
    active layout per project. No letterhead-snapshot equivalent — unlike
    GanttLayout, nothing outside this row needs pushing on apply.

    config is JSONB, not flat columns, for the same reason as GanttLayout's
    style — read/written as one unit, and its shape (which windows are open,
    their per-key dock side, dock heights, split ratios) is FourD.tsx's own
    concern, not this table's."""

    __tablename__ = "dock_layouts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=lambda: dict(DEFAULT_CONFIG))
