from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# Mirrors frontend/src/modules/dashboard/DashboardGrid.tsx's own widget
# state exactly (id/widget_type/x/y/w/h, the same shape react-grid-layout
# itself consumes) — see dashboard_layout.py's own header.
class DashboardWidgetConfig(BaseModel):
    id: str
    widget_type: str
    x: int
    y: int
    w: int
    h: int
    # Per-widget filter (2026-09-02, per Maro: "what if you allowed
    # flexibility to those widgets") — a plain string-keyed dict, not a
    # typed shape per widget_type, same "shape owned by the frontend"
    # convention this config's own class docstring already establishes for
    # the rest of this schema. Only the widgets that actually support one
    # read specific keys out of it (see frontend widgets.tsx's own
    # WidgetProps.filter header); everything else ignores it.
    filter: dict[str, str] | None = None


class DashboardLayoutConfig(BaseModel):
    widgets: list[DashboardWidgetConfig] = Field(default_factory=list)


class DashboardLayoutCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    config: DashboardLayoutConfig = DashboardLayoutConfig()


class DashboardLayoutUpdate(BaseModel):
    name: str
    config: DashboardLayoutConfig = DashboardLayoutConfig()


class DashboardLayoutResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    is_active: bool
    config: DashboardLayoutConfig
    created_at: datetime
    updated_at: datetime
