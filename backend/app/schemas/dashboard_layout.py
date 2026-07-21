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
