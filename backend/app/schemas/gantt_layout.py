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
    # Activity table only — see gantt_font_family below for the Gantt
    # column's own independent font-type control.
    table_font_family: FontFamily = "sans"
    # Pixel font size for the on-screen activity table — 14 matches the
    # pre-existing hardcoded `text-sm` Tailwind class, so an unset/default
    # layout renders identically to before this field existed (2026-07-06, per
    # Maro: "in layout i want to be able to increase the font size").
    table_font_size: int = Field(default=14, ge=10, le=24)
    # The activity table's own header row (Code/WBS/Type/... column labels),
    # screen only — see header_font_size's own history below.
    header_font_size: int = Field(default=12, ge=6, le=24)
    header_font_family: FontFamily = "sans"
    # Gantt-column text, screen only (timeline header marks + the optional
    # name/resource/finish bar label trio) — independent of table_font_size
    # since this text sits inside the Gantt column, not the data columns
    # (2026-07-06, per Maro: "i want the option for the gantt fonts including
    # the gantt timeline header fonts"). Default matches the pre-existing
    # hardcoded screen size (`text-[10px]`) so an unset/default layout renders
    # identically to before this field existed.
    #
    # print_font_size/header_print_font_size/gantt_print_font_size (added
    # 2026-07-06 alongside these) moved to ProjectLetterhead (2026-07-07, per
    # Maro: "move the font parameters relating to print from the layout") —
    # a Layout is a named, switchable *screen theme*; print settings live
    # with Page Setup's other print-only controls (Print Column Widths/
    # Timescale) instead, so they're set/previewed in one place. See
    # app/schemas/project_letterhead.py.
    gantt_font_size: int = Field(default=10, ge=6, le=24)
    # Font type for that same Gantt-column text, independent of
    # table_font_family (2026-07-07, per Maro: "font type parameters not
    # just the size... affecting gantt and activity table content") — until
    # now there was only one shared font family for both, even though size
    # already had this same table-vs-gantt split.
    gantt_font_family: FontFamily = "sans"
    # One colour per WBS nesting level (Gantt jagged line + activity table row
    # shade both draw from this same palette, so a level's colour identity
    # matches in both places) — replaces the old single wbs_summary_color/
    # wbs_row_color pair.
    wbs_level_colors: list[str] = Field(default_factory=lambda: list(DEFAULT_WBS_LEVEL_COLORS))
    activity_row_color: str = Field(default="#ffffff", pattern=_HEX_PATTERN)
    milestone_row_color: str = Field(default="#a855f7", pattern=_HEX_PATTERN)
    # Display-only toggle (2026-07-05, per Maro) — doesn't affect any stored
    # or computed value, just whether the activity table/print view shows a
    # date's time-of-day (e.g. "06 Jul 2026 09:00" vs "06 Jul 2026").
    show_time_of_day: bool = True
    # Gantt display toggles (2026-07-05, per Maro) — same on-screen/print
    # split as everything else in GanttStyle. show_connectors hides the
    # predecessor/successor elbow lines entirely (GanttChart.tsx's SVG /
    # SchedulingPrintView.tsx's positioned divs) rather than just the
    # arrowheads. The show_label_* trio each independently add a small text
    # label to the right of a bar/milestone — off by default, since this is
    # new information appearing next to every bar, not a toggle for
    # something already always shown.
    show_connectors: bool = True
    show_label_name: bool = False
    show_label_resource: bool = False
    show_label_finish: bool = False
    # Sub-project float secondary indicator (2026-07-06, per Maro —
    # docs/SUBPROJECT_FLOAT_PLAN.md §G). Master critical path renders exactly
    # as today, unchanged — this is a second, distinct marker shown only when
    # an activity is critical *within its own tagged sub-project's* scoped
    # pass (sub_is_critical) but not on the master critical path (is_critical)
    # — surfacing a package quietly eating its own internal float before it
    # ever reaches the master critical path. On by default, same as the
    # master critical colour always being visible.
    sub_critical_color: str = Field(default="#f97316", pattern=_HEX_PATTERN)
    show_sub_critical: bool = True
    # Row tint for the activity-table Highlight widget (2026-07-06, per Maro
    # — "works exactly like the filter", "allow me to set the highlight
    # colour in the layout"). One shared colour for every enabled highlight
    # (built-in "Critical" + any saved custom rules), same as critical_color
    # is one shared colour for the master critical path everywhere else.
    # Replaces the old *automatic, always-on* critical-row tint that used to
    # be baked into the table (that was critical_color itself, still used
    # unchanged for Gantt bars/other cues) — highlighting a row is now always
    # an explicit opt-in via SchedulingHighlightsWidget, off by default.
    highlight_color: str = Field(default="#ef4444", pattern=_HEX_PATTERN)

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
