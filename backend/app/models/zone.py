from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Zone(Base, TimestampMixin):
    """A filled, labeled ground-plane area (2026-07-29, per Maro's own
    site-logistics reference screenshots — a "PROJECT SITE" style boundary:
    a colored polygon with a bold label sitting flat on the site, distinct
    from Path (path.py), which is a genuine 3D curve objects animate along.
    A Zone's points are deliberately a flat *footprint* only — the up-axis
    coordinate of every point here is always written as 0 and ignored by
    the frontend's own zoneGeometry.ts — with `elevation` as the one real,
    separately-editable "how high off the ground" scalar (per Maro: "height
    can be editable in transform options"), rather than per-vertex height
    editing. Same "one opaque JSONB blob, shape owned by the frontend"
    convention as Path.points/MaterialPreset.config.

    visible mirrors Path's own identical field — live-viewport helper
    visibility, not a rendering-time capture override.

    shape/radius (2026-07-30, per Maro's own reference screenshot — a
    dashed clearance ring under a crane, "the radial zone for things like
    crane clearance etc") — shape="circle" is a second footprint kind
    alongside the original "polygon": `points` holds exactly one entry
    (the center) instead of 3+ corners, and `radius` (world units) is the
    one extra scalar that actually draws it, same "one extra numeric
    field, not a whole new points shape" spirit `elevation` already uses.
    Deliberately its own `shape` kind rather than inferring "circle" from
    a 1-point `points` array — a zone mid-trace with only one corner so
    far would otherwise look identical to a real circle. kind is fixed at
    creation (ZonesPanel.tsx's own "+ Zone"/"+ Circle" buttons), not
    switchable after — same spirit Annotation's own `kind` already is,
    since a polygon's extra corners would just become dead data the
    frontend's own circle renderer (zoneGeometry.ts) silently ignores.
    Every other field (fill/border/elevation/animate/...) is shared and
    means exactly the same thing for either shape."""

    __tablename__ = "zones"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="Zone")
    shape: Mapped[str] = mapped_column(String(10), nullable=False, default="polygon")  # "polygon" | "circle"
    points: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    radius: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    elevation: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    fill_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#ef4444")
    fill_opacity: Mapped[float] = mapped_column(Float, nullable=False, default=0.35)
    border_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#ffffff")
    # 2026-07-29, per Maro: "add border thickness controls" — pixel line
    # width for ZoneGizmo.tsx's own border Line, same scale/units as Path's
    # matching line_width (path.py).
    border_width: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    # 2026-07-29, per Maro: "include dashed border options and spacing for
    # zones" — same solid/dashed convention as Path.line_style, and same
    # dash/gap-size shape as Path.dash_size/gap_size (path.py), just scoped
    # to a zone's own border Line instead of a route's.
    border_style: Mapped[str] = mapped_column(String(10), nullable=False, default="solid")
    border_dash_size: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    border_gap_size: Mapped[float] = mapped_column(Float, nullable=False, default=0.3)
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Reveal animation (2026-07-29, per Maro: "the animation will go like
    # path to set the border then the fill, can also set a flashing zone
    # animation"). animation_mode picks what ZoneGizmo.tsx actually does
    # across the reveal window: 'draw' traces the border first, then fades
    # the fill in, in sequence (the first half draws the border, the
    # second half fades the fill); 'flash' instead pulses the fill opacity
    # for as long as `animate` is on, ignoring the border/fill sequencing
    # entirely. The reveal window's own start/end instants are NOT columns
    # here (2026-07-30 rework — see path.py's own animate field header for
    # the full "why"/reference to Maro's own words) — they're ElementKeyframe
    # rows instead (source_kind="zone", element_ref=this row's own id,
    # field="anim_start"/"anim_end").
    animate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    animation_loop: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    animation_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="draw")
