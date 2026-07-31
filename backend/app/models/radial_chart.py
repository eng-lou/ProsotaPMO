from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class RadialChart(Base, TimestampMixin):
    """A screen-space progress ring HUD widget for the 4D viewport
    (2026-07-31, per Maro's own Synchro-style reference screenshot — a
    black label bar over a circular ring, e.g. "CONCRETE STRUCTURE" filled
    orange as that discipline's work progresses). Unlike Zone/Annotation/
    Path, this is NOT a 3D-world object — it's a HUD overlay pinned to a
    location on the 2D viewport itself (position_x_pct/position_y_pct),
    the same "percent of the viewport rect, not raw pixels" reasoning
    RenderCaptureSettings.resolutionWidth/Height already established for
    output-resolution independence, so a chart dragged into a corner lands
    in the same visual spot regardless of window size or export resolution.

    Progress is never stored here — it's computed live, client-side, each
    frame, from whichever Activities currently match
    udf_field_definition_id/udf_value (a User Defined Field filter, e.g.
    "Sub Discipline" = "Concrete Works" — see
    radialChartProgress.ts/user_defined_field.py) as of wherever the
    Animation Timeline's playhead currently sits: duration-weighted elapsed
    fraction across the matched set, the same per-activity 0..1 fraction
    math already used by scheduling_cpm.py's own elapsed_duration_fraction,
    just ported to run against an arbitrary scrubbed date instead of a
    SchedulePeriod's fixed data_date.

    udf_field_definition_id/udf_value null = "all Activities in the
    project" — a freshly-created chart shows real (if uninteresting)
    progress immediately rather than erroring or sitting blank before it's
    configured, same spirit Zone/Annotation's own sensible-default fields
    already follow.

    visible gates BOTH the live viewport (same "live-viewport helper
    visibility" convention as Zone.visible/Annotation.visible) AND export —
    a chart hidden live is never silently baked into a capture even when
    RenderCaptureSettings.includeRadialCharts is on, deliberately not a
    second independent flag.

    center_mode="percentage" shows the live "NN%" as plain text;
    "icon"+icon_storage_filename shows an uploaded PNG instead (same
    "opaque UUID-based disk filename, original name never trusted"
    convention as MaterialPresetTexture.storage_filename — actual bytes
    live on disk under model3d_storage.py's shared storage_dir(), reused
    directly rather than standing up a second storage location for what's
    still just "one small uploaded image per row.")"""

    __tablename__ = "radial_charts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="Radial Chart")
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    position_x_pct: Mapped[float] = mapped_column(Float, nullable=False, default=4.0)
    position_y_pct: Mapped[float] = mapped_column(Float, nullable=False, default=70.0)
    radius_px: Mapped[float] = mapped_column(Float, nullable=False, default=48.0)
    thickness_px: Mapped[float] = mapped_column(Float, nullable=False, default=8.0)
    border_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#ffffff")
    track_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#374151")
    progress_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#f97316")
    fill_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#111827")
    text_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#ffffff")
    center_mode: Mapped[str] = mapped_column(String(12), nullable=False, default="percentage")  # "percentage" | "icon"
    icon_storage_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    udf_field_definition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_defined_field_definitions.id", ondelete="SET NULL"), nullable=True
    )
    udf_value: Mapped[str | None] = mapped_column(String(500), nullable=True)
