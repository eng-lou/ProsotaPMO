from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# Same {field, operator, value} shape as scheduling_filter.py's own
# SchedulingFilter.conditions (2026-09-02, per Maro: "see how we use the
# filters/highlights in the schedule. functionality is definitely there" —
# a flat equals-only dict, this schema's first-pass shape, couldn't ever
# express a numeric/date comparison or a WBS-subtree starts_with, and
# reinventing a second, weaker condition language when a real one already
# existed and was proven would've been pure duplication). operator is the
# exact same vocabulary as FilterOperator (frontend
# modules/scheduling/types.ts) — not re-declared as a backend enum, since
# this whole config is opaque JSONB, evaluated only ever on the frontend
# (dashboardFilters.ts's own evaluateDashboardCondition), same as every
# other field in this file.
class DashboardWidgetFilterCondition(BaseModel):
    field: str
    operator: str
    value: str


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
    # flexibility to those widgets", generalized same day to a real
    # condition list — see DashboardWidgetFilterCondition's own header).
    # Only the widgets that actually support one read this (see frontend
    # widgets.tsx's own WidgetProps.filter header); everything else
    # ignores it.
    filter: list[DashboardWidgetFilterCondition] | None = None
    filter_match_mode: str = "all"


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
