from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

FontFamily = Literal["sans", "serif", "mono"]

_HEX_PATTERN = r"^#[0-9a-fA-F]{6}$"

# Six WBS nesting levels (0 = top-level summary) — matches the six-level
# minimum Maro asked for. Depths beyond the array clamp to the last colour
# (see frontend/src/lib/ganttLayout.ts:wbsLevelColor) rather than repeating
# an arbitrary WBS outline any deeper.
DEFAULT_WBS_LEVEL_COLORS = ["#374151", "#4b5563", "#6b7280", "#9ca3af", "#94a3b8", "#cbd5e1"]


class GanttStyle(BaseModel):
    critical_color: str = Field(default="#ef4444", pattern=_HEX_PATTERN)
    non_critical_color: str = Field(default="#3b82f6", pattern=_HEX_PATTERN)
    milestone_critical_color: str = Field(default="#ef4444", pattern=_HEX_PATTERN)
    milestone_noncritical_color: str = Field(default="#3b82f6", pattern=_HEX_PATTERN)
    baseline_color: str = Field(default="#eab308", pattern=_HEX_PATTERN)
    baseline_thickness: int = Field(default=7, ge=2, le=20)
    table_font_color: str = Field(default="#111827", pattern=_HEX_PATTERN)
    table_font_family: FontFamily = "sans"
    # One colour per WBS nesting level (Gantt jagged line + activity table row
    # shade both draw from this same palette, so a level's colour identity
    # matches in both places) — replaces the old single wbs_summary_color/
    # wbs_row_color pair.
    wbs_level_colors: list[str] = Field(default_factory=lambda: list(DEFAULT_WBS_LEVEL_COLORS))
    activity_row_color: str = Field(default="#ffffff", pattern=_HEX_PATTERN)
    milestone_row_color: str = Field(default="#a855f7", pattern=_HEX_PATTERN)

    @field_validator("wbs_level_colors")
    @classmethod
    def _check_wbs_colors(cls, v: list[str]) -> list[str]:
        import re
        if not (1 <= len(v) <= 12):
            raise ValueError("wbs_level_colors must have between 1 and 12 entries.")
        for c in v:
            if not re.fullmatch(_HEX_PATTERN, c):
                raise ValueError(f"'{c}' is not a valid #rrggbb colour.")
        return v


class GanttLayoutCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    style: GanttStyle = GanttStyle()


class GanttLayoutUpdate(BaseModel):
    name: str
    style: GanttStyle = GanttStyle()


class GanttLayoutResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    is_active: bool
    style: GanttStyle
    created_at: datetime
    updated_at: datetime
