from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.gantt_layout import FontFamily

Align = Literal["left", "center", "right", "justify"]

# Printed Gantt timescale bounds (2026-07-06, per Maro — P6's own Print
# dialog's "Timescale Start/Finish" shorthand): PS/PF = the earliest/latest
# activity Start/Finish across the current schedule, DD = the live period's
# Data Date, CD = today, CW/CM = the start of the current calendar week/month,
# custom = an exact literal date (timescale_*_custom_date). "auto" keeps the
# existing activities-derived range computation (SchedulingPrintView.tsx) —
# the default, so no project's print output changes until someone opts in.
TimescaleAnchorMode = Literal["auto", "ps", "pf", "dd", "cd", "cw", "cm", "custom"]

# ~500KB of raw bytes, base64-inflated (~4/3x) plus the "data:image/...;base64,"
# prefix — generous for a logo, small enough to keep in a DB text column
# without needing real file storage (see app/models/project_letterhead.py).
MAX_LOGO_DATA_URL_LENGTH = 700_000


class LetterheadZone(BaseModel):
    text: str = ""
    bold: bool = False
    italic: bool = False
    font_size: int = Field(default=11, ge=6, le=32)
    # 2026-07-07, per Maro: "also need font types for the headers/footers" —
    # same sans/serif/mono set as GanttStyle's own font-family fields
    # (app/schemas/gantt_layout.py). Header/footer zones are stored as a
    # JSONB blob (ProjectLetterhead.header_zones/footer_zones), so adding
    # this needs no migration — an existing saved zone missing this key
    # simply gets the default when reconstructed.
    font_family: FontFamily = "sans"
    align: Align = "left"


class ProjectLetterheadUpsert(BaseModel):
    project_id: uuid.UUID
    logo_data_url: str | None = None
    logo_position: Literal["left", "center", "right"] = "left"
    header_left: LetterheadZone = LetterheadZone()
    header_center: LetterheadZone = LetterheadZone()
    header_right: LetterheadZone = LetterheadZone()
    footer_left: LetterheadZone = LetterheadZone()
    footer_center: LetterheadZone = LetterheadZone()
    footer_right: LetterheadZone = LetterheadZone()
    # Preset "how to read the Gantt" key (colour/shape legend) — see
    # app/models/project_letterhead.py. Only Scheduling's print view renders
    # it; harmless (ignored) elsewhere.
    show_gantt_legend: bool = False
    # See TimescaleAnchorMode above / app/models/project_letterhead.py.
    timescale_start_mode: TimescaleAnchorMode = "auto"
    timescale_finish_mode: TimescaleAnchorMode = "auto"
    timescale_start_custom_date: date | None = None
    timescale_finish_custom_date: date | None = None
    # See app/models/project_letterhead.py — a missing key means "use
    # PRINT_COLUMN_DEFAULTS" (Scheduling.tsx), same as this whole model's
    # other "auto"/None-means-unchanged fields above.
    print_column_widths: dict[str, int] = Field(default_factory=dict)
    print_udf_column_width: int | None = None
    # Moved from GanttStyle (2026-07-07, per Maro: "move the font parameters
    # relating to print from the layout") — a Layout is a named, switchable
    # *screen* theme; print's own font sizes now live alongside Page Setup's
    # other print-only controls (column widths/timescale) instead, previewed
    # together in one place. Same defaults as GanttStyle's own previously
    # (9/9/8) so no project's print output changes until someone adjusts one.
    print_font_size: int = Field(default=9, ge=6, le=24)
    header_print_font_size: int = Field(default=9, ge=6, le=24)
    gantt_print_font_size: int = Field(default=8, ge=6, le=24)
    # The Gantt Legend ("how to read the Gantt" key in the footer) is print-
    # only — no on-screen equivalent — so its own font size lives here
    # alongside the other print-only font controls rather than on GanttStyle.
    gantt_legend_font_size: int = Field(default=9, ge=6, le=24)
    # Print's own font *type*, independent of GanttStyle's screen-only
    # table_font_family/gantt_font_family — same table-vs-gantt split as the
    # print font sizes just above.
    print_font_family: FontFamily = "sans"
    gantt_print_font_family: FontFamily = "sans"
    # Header row (Code/WBS/Type/... column labels) and Gantt Legend each get
    # their own print font type too (2026-07-07, per Maro) — mirrors
    # header_font_family now existing on GanttStyle for the screen side;
    # gantt_legend_font_family has no screen equivalent (the legend is
    # print-only), same as gantt_legend_font_size.
    header_print_font_family: FontFamily = "sans"
    gantt_legend_font_family: FontFamily = "sans"

    @field_validator("logo_data_url")
    @classmethod
    def _check_logo_size(cls, v: str | None) -> str | None:
        if v is not None and len(v) > MAX_LOGO_DATA_URL_LENGTH:
            raise ValueError("Logo is too large — please use a smaller image (roughly under 500KB).")
        return v


class ProjectLetterheadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # None = nothing saved yet for this project — get_or_default returns an
    # in-memory default in that case rather than a DB row, so the frontend
    # doesn't have to special-case a 404.
    id: uuid.UUID | None = None
    project_id: uuid.UUID
    logo_data_url: str | None
    logo_position: Literal["left", "center", "right"]
    header_left: LetterheadZone
    header_center: LetterheadZone
    header_right: LetterheadZone
    footer_left: LetterheadZone
    footer_center: LetterheadZone
    footer_right: LetterheadZone
    show_gantt_legend: bool
    timescale_start_mode: TimescaleAnchorMode
    timescale_finish_mode: TimescaleAnchorMode
    timescale_start_custom_date: date | None
    timescale_finish_custom_date: date | None
    print_column_widths: dict[str, int] = Field(default_factory=dict)
    print_udf_column_width: int | None = None
    print_font_size: int = 9
    header_print_font_size: int = 9
    gantt_print_font_size: int = 8
    gantt_legend_font_size: int = 9
    print_font_family: FontFamily = "sans"
    gantt_print_font_family: FontFamily = "sans"
    header_print_font_family: FontFamily = "sans"
    gantt_legend_font_family: FontFamily = "sans"
    created_at: datetime | None = None
    updated_at: datetime | None = None
