from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Path(Base, TimestampMixin):
    """A reusable 3D curve (2026-07-11, per Maro: "in blender you can add a
    curve, edit it and set a path from point a to be... i can then place an
    object to follow that path") — Blender's own Curve object, scoped down
    to what this app actually needs: an ordered list of control points a
    PathFollower (path_follower.py) interpolates a smooth position along,
    nothing else. Project-scoped, not tied to any one Model3DFile — unlike
    SectionBox (bounds meaningful only in one target's own local space), a
    path is placed directly in world space and is meant to be reusable
    across whatever's bound to it (the camera, one element, or several).

    points is a JSONB array of {x, y, z} objects, not a separate child
    table — same "one opaque JSONB blob, shape owned by the frontend"
    convention as MaterialPreset's own config (see material_preset.py),
    chosen for the same reason: this is always read/written as one whole
    list (add/remove/drag a point rewrites the array wholesale from the
    frontend's own PathGizmo), never queried per-point.

    visible is this path's own live-viewport helper visibility (the curve
    line + control-point handles) — independent of whether it's actually
    hidden in a given capture/export, which is a *rendering-time* decision
    (Viewport3D.tsx forces every path helper invisible right before
    capturing, then reverts, same pattern already used for the HDR
    background override) rather than a persisted project setting; visible
    here is "do I want to see/edit this path's shape right now," matching
    SectionBox's own identical visible/active split."""

    __tablename__ = "paths"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="Path")
    points: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Cyclic U (2026-07-11) — Blender's own term for a curve that loops back
    # to its first point instead of ending at its last one.
    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Route display styling (2026-07-29, per Maro's site-logistics reference
    # — a haul route drawn as a dashed, colored, arrowed, labeled line, e.g.
    # "RIG 1"/"RIG 2"). color's default is PathGizmo.tsx's own pre-existing
    # LINE_COLOR constant, so an already-created path renders pixel-identical
    # before and after this migration. Purely a display concern — none of
    # this affects PathFollower's own interpolation along `points`.
    color: Mapped[str] = mapped_column(String(9), nullable=False, default="#38bdf8")
    line_style: Mapped[str] = mapped_column(String(10), nullable=False, default="solid")
    show_arrow: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    show_label: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 2026-07-29, per Maro: "add line size controls" — pixel line width for
    # PathGizmo.tsx's own route Line, default 2 matches that component's
    # pre-existing hardcoded lineWidth, so an already-created path renders
    # unchanged before/after this migration.
    line_width: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    # 2026-07-29, per Maro: "if dashed, allow for dash spacing controls" —
    # world-unit dash/gap length for PathGizmo.tsx's own drei <Line dashed>,
    # only visually meaningful while line_style="dashed". Defaults match
    # that component's own pre-existing hardcoded DASH_SIZE/GAP_SIZE
    # constants, so an already-created dashed path renders unchanged.
    dash_size: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    gap_size: Mapped[float] = mapped_column(Float, nullable=False, default=0.3)
    # Line-draw animation (2026-07-29, per Maro: "animate the line itself so
    # it looks like its coming from the first point to the last with the
    # arrow as well if enabled"). animation_loop repeats the reveal every
    # (end - start) once `now` passes the end instant, instead of holding
    # fully-drawn. The reveal window's own start/end instants are NOT
    # columns here (2026-07-30 rework, per Maro: "at the moment for the
    # animation to work i have to create a task but this segment needs to
    # work independent of that... if i keyframe i should see the path
    # actor in the timeline with both keyframes so i can drag, delete
    # etc") — they're ElementKeyframe rows instead (source_kind="path",
    # element_ref=this row's own id, field="anim_start"/"anim_end"), the
    # same date-keyed shape every other animated actor already uses. See
    # element_keyframe.py's own KeyframeField header for the full "why":
    # a keyframe's own `date` *is* the start/end instant, which is what
    # makes it drag/delete-able in AnimationActorsList.tsx's dope sheet,
    # and what lets the timeline's own scrubbable range extend the moment
    # either one is keyed — no dated Activity required at all.
    animate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    animation_loop: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
