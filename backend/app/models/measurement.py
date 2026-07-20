from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Measurement(Base, TimestampMixin):
    """A saved length or area measurement in the 4D viewport (2026-07-19,
    per Maro: "add a measurement feature, length and areas" — Navisworks'
    own Measure tool, scoped to what this app persists elsewhere: saved,
    listed, toggleable, project-scoped, same shape as Annotation/Path/
    SectionBox rather than an ephemeral tool that forgets itself on reload.

    kind="length": exactly 2 points, the straight-line distance between
    them. kind="area": 3+ points, a planar polygon's area (Newell's method,
    which is robust to the polygon not being axis-aligned — a wall/roof
    face is rarely perfectly flat to any one global axis).

    points is a JSONB array of {x,y,z} objects in scene-space (the same
    "one opaque JSONB blob, shape owned by the frontend" convention Path's
    own docstring already established) — purely for redrawing the
    measurement's line/outline back in the viewport. NOT what value below
    is computed from directly: scene units are whatever the source IFC
    file's own LENGTHUNIT declares (see ifcModel.ts's getLengthUnitToMetres
    header — sceneClash.ts already documents the same "known v1
    simplification" for clash tolerances), so the frontend converts to
    real metres/m² using that factor before persisting value, the same
    "compute the real number client-side, persist it as its own field"
    convention ClashResult.distance_mm already uses. A measurement is the
    one feature in this app whose entire purpose is a trustworthy real-
    world number, so this is the one place that conversion isn't skipped.

    A "measure a clicked face" mode (2026-07-19, per Maro: "maybe i can
    also click element surfaces and it gives me the area") still produces
    an ordinary kind="area" row — points there is the flood-filled
    coplanar patch's own real traced outer boundary (not a convex hull —
    see measurementGeometry.ts's own measureFacePatch header for why that
    distinction matters for a non-convex or holed face), while value is the
    true summed triangle area of that patch, computed directly off the
    mesh's real geometry — more accurate than the bounding-box estimate
    ifcScheduleExtraction.ts's own measureElement uses for BOQ quantities.

    hole_loops (2026-07-19, per Maro: "can it detect and exclude the
    voids?") — every other closed boundary loop measureFacePatch traced
    inside that same patch, i.e. a real opening (window/duct/etc.) cut into
    the clicked face. value is already net of every hole with no help from
    this field at all — a hole has no triangles under it to sum in the
    first place — hole_loops exists purely so the viewport can *draw* each
    hole's own outline too, not to correct the area. Always empty for
    kind="length" or a manually points-clicked kind="area".

    visible is this measurement's own live-viewport helper visibility,
    same visible-only-toggle convention SectionBox/Path/Annotation already
    each have independently."""

    __tablename__ = "measurements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="Measurement")
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "length" | "area"
    points: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    hole_loops: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Real-world metres (length) or square metres (area) — see this class's
    # own docstring for why this is a separately-persisted, already-
    # unit-converted number rather than something re-derived from points
    # (which stay in raw, unconverted scene units).
    value: Mapped[float] = mapped_column(Float, nullable=False)
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
