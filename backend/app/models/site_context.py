from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SiteContext(Base, TimestampMixin):
    """A project's real-world anchor for the 4D viewport's "Site Context"
    layer — Google Photorealistic 3D Tiles, embedded as a real object in
    the main three.js viewport (2026-08-19, per Maro: a genuinely separate
    CesiumJS panel — this table's second revision, since deleted — worked
    for viewing tiles but had none of the main viewport's own tooling
    (Select All/Isolate/Capture/Export Video), a hard limit of running two
    separate WebGL engines rather than a missing feature; corrected back
    to embedding real-world tiles directly in the existing scene). Same
    "one row per project, get-or-default, PUT-upserts-the-whole-row"
    singleton shape as TimelineStrip/ProjectLetterhead.

    lat/lon anchor the tileset's own real-world root — the frontend
    recentres the (globally-rooted, ECEF) tileset near this point via
    Ellipsoid.getEastNorthUpFrame (3d-tiles-renderer's own math, see
    SiteTilesLayer.tsx), landing it at local scene origin, Y-up/X-East,
    before the app's usual axisCorrectionRotation wrapper. offset_x/y/z
    (local scene units), offset_yaw_deg (extra rotation about the up
    axis), and scale are a plain manual nudge on top of that recentre —
    typed numbers in SiteContextPanel.tsx, not a two-point calibration
    (an earlier revision of this model had two full lat/lon-paired
    calibration points plus local-coordinate drift correction, built for
    a design that needed to auto-derive rotation+scale; dropped as
    unnecessary complexity once the plan simplified to "nudge it into
    place by eye")."""

    __tablename__ = "site_contexts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Real-world height above the WGS84 ellipsoid, metres, at lat/lon — fed
    # straight into getEastNorthUpFrame's own height parameter
    # (SiteTilesLayer.tsx), previously hardcoded to 0. Distinct from
    # offset_z below, which is a manual local-scene-unit nudge applied on
    # top of this recentre, not a real-world value.
    elevation: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # Free text shown as the panel's own heading — e.g. a site address or
    # "Site boundary," not parsed/validated, purely a label for the
    # planner's own reference.
    label: Mapped[str | None] = mapped_column(String(300), nullable=True)

    offset_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    offset_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    offset_z: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    offset_yaw_deg: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
