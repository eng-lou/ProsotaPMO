from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DockSide = Literal["top", "bottom"]


# Mirrors frontend/src/modules/fourD/FourD.tsx's own dock-layout state
# exactly (openWindows/windowDock/topDockHeight/bottomDockHeight/split
# ratios/propertiesOpen/dataPanelOpen) — see dock_layout.py's own header.
class DockLayoutConfig(BaseModel):
    open_windows: list[str] = Field(default_factory=list)
    window_dock: dict[str, DockSide] = Field(default_factory=dict)
    top_dock_height: float = 320
    bottom_dock_height: float = 320
    top_split_ratios: list[float] = Field(default_factory=list)
    bottom_split_ratios: list[float] = Field(default_factory=list)
    properties_open: bool = True
    data_panel_open: bool = True


class DockLayoutCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    config: DockLayoutConfig = DockLayoutConfig()


class DockLayoutUpdate(BaseModel):
    name: str
    config: DockLayoutConfig = DockLayoutConfig()


class DockLayoutResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    is_active: bool
    config: DockLayoutConfig
    created_at: datetime
    updated_at: datetime
