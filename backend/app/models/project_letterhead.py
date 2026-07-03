from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# A zone's shape (kept only here, in the docstring, and mirrored on the frontend
# in frontend/src/lib/letterhead.ts — not worth a DB-level schema for a 5-field
# blob that always reads/writes as a whole unit):
#   { text: str, bold: bool, italic: bool, font_size: int, align: "left"|"center"|"right"|"justify" }
DEFAULT_ZONE = {"text": "", "bold": False, "italic": False, "font_size": 11, "align": "left"}


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
