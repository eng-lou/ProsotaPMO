from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# A zone's shape (kept only here, in the docstring, and mirrored on the frontend
# in frontend/src/lib/letterhead.ts — not worth a DB-level schema for a 6-field
# blob that always reads/writes as a whole unit):
#   { text: str, bold: bool, italic: bool, font_size: int, font_family: "sans"|"serif"|"mono", align: "left"|"center"|"right"|"justify" }
DEFAULT_ZONE = {"text": "", "bold": False, "italic": False, "font_size": 11, "font_family": "sans", "align": "left"}


class ProjectLetterhead(Base, TimestampMixin):
    """One shared, editable print header/footer per project (2026-07-03, per
    Maro) — used by every module's print view (Risk/ICD/Cost/Scheduling), so a
    logo or custom header text set once shows up consistently across all
    printed reports for that project, rather than being a per-module or
    per-browser setting.

    header_zones/footer_zones are JSONB dicts keyed "left"/"center"/"right",
    each holding a Zone (see DEFAULT_ZONE above) — a flat table would need 30
    columns (3 zones x 2 header/footer x 5 style fields) for something that's
    always read and written as one unit; JSONB keeps that as two columns.
    Zone text may contain {project}/{module}/{count}/{printed_at} tokens,
    substituted per print by frontend/src/components/PrintLetterhead.tsx — so
    a saved header stays "live" (today's project name/date) rather than
    freezing whatever was true when it was last edited.

    One row per project (project_id unique) — created lazily on first save;
    app/services/project_letterhead.py:get_or_default returns an in-memory
    default (matching the print views' original hardcoded header) when no row
    exists yet, so the frontend never has to special-case "not customized"."""

    __tablename__ = "project_letterheads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    # Base64 data URI (e.g. "data:image/png;base64,...") — no S3/disk storage
    # exists in this codebase yet (see docs/PROJECT_STATE.md), and a logo is
    # small enough (capped at 500KB in the schema) that a DB text column is the
    # simplest fit for this project's current scale, matching no-premature-infra.
    logo_data_url: Mapped[str | None] = mapped_column(Text)
    logo_position: Mapped[str] = mapped_column(String(10), nullable=False, default="left")
    header_zones: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=lambda: {"left": dict(DEFAULT_ZONE), "center": dict(DEFAULT_ZONE), "right": dict(DEFAULT_ZONE)}
    )
    footer_zones: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=lambda: {"left": dict(DEFAULT_ZONE), "center": dict(DEFAULT_ZONE), "right": dict(DEFAULT_ZONE)}
    )
    # 2026-07-03, per Maro: an optional preset key explaining the Gantt's
    # symbols (critical/non-critical/progress/milestone/dependency/WBS/baseline)
    # — only Scheduling's print view actually renders it (see
    # frontend/src/components/GanttLegend.tsx), since it's meaningless
    # anywhere a Gantt chart doesn't appear.
    show_gantt_legend: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Printed Gantt timescale bounds (2026-07-06, per Maro — modelled on P6's
    # own Print dialog's "Timescale Start/Finish" fields, with the same PS/PF/
    # DD/CD/CW/CM preset shorthand plus a literal custom date). Only
    # Scheduling's print view uses these (see SchedulingPrintView.tsx's
    # computeGanttRange) — harmless/ignored elsewhere, same as
    # show_gantt_legend above. "auto" (the default) means "keep computing the
    # range from the activities' own dates the way this always has" — every
    # existing project prints identically until someone explicitly picks a
    # preset or a custom date for one side.
    timescale_start_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="auto")
    timescale_finish_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="auto")
    timescale_start_custom_date: Mapped[date | None] = mapped_column(Date)
    timescale_finish_custom_date: Mapped[date | None] = mapped_column(Date)
    # Print's own column widths (2026-07-07, per Maro — "let that be inside
    # the page setup, like the way print timescale is in there"): a project-
    # wide, per-column pixel width for the printed Scheduling activity table,
    # independent of each browser's own on-screen resized widths (on-screen
    # widths are tuned for the interactive font/columns; print's own
    # uppercase, tracking-wide header font needs different proportions — a
    # width that fits "Dur" on-screen truncated to "DUR (..." in print).
    # Keyed by the same column keys as frontend/src/modules/scheduling/
    # Scheduling.tsx's own ColumnKey union plus "activity" — an empty/missing
    # key means "use PRINT_COLUMN_DEFAULTS", so no existing project's print
    # output changes until someone explicitly adjusts a width, same "auto
    # means unchanged" precedent as timescale_start_mode above. Only
    # Scheduling's print view reads this; harmless/ignored elsewhere.
    print_column_widths: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # All UDF columns share one printed width (2026-07-07, per Maro) — there's
    # no on-screen per-field resizable width to mirror per column the way
    # built-in columns have. None = PRINT_UDF_COLUMN_DEFAULT_WIDTH.
    print_udf_column_width: Mapped[int | None] = mapped_column(Integer)
    # Moved from GanttStyle/GanttLayout (2026-07-07, per Maro: "move the font
    # parameters relating to print from the layout") — a Layout is a named,
    # switchable *screen* theme; these are print-only, so they now live with
    # Page Setup's other print-only controls instead, all previewed together
    # in one place. Same defaults GanttStyle always had (9/9/8).
    print_font_size: Mapped[int] = mapped_column(Integer, nullable=False, default=9)
    header_print_font_size: Mapped[int] = mapped_column(Integer, nullable=False, default=9)
    gantt_print_font_size: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    # The Gantt Legend is print-only (no on-screen equivalent), so its own
    # font size lives here too rather than on GanttStyle.
    gantt_legend_font_size: Mapped[int] = mapped_column(Integer, nullable=False, default=9)
    # Print's own font *type*, independent of GanttStyle's screen-only
    # table_font_family/gantt_font_family — same table-vs-gantt split as the
    # print font sizes above.
    print_font_family: Mapped[str] = mapped_column(String(10), nullable=False, default="sans")
    gantt_print_font_family: Mapped[str] = mapped_column(String(10), nullable=False, default="sans")
    # Header row and Gantt Legend print font types (2026-07-07, per Maro) —
    # mirrors header_font_family now on GanttStyle for the screen side;
    # gantt_legend_font_family has no screen equivalent, same as its size.
    header_print_font_family: Mapped[str] = mapped_column(String(10), nullable=False, default="sans")
    gantt_legend_font_family: Mapped[str] = mapped_column(String(10), nullable=False, default="sans")
