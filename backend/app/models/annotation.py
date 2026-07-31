from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Annotation(Base, TimestampMixin):
    """A Placemark or Comment in the 4D viewport (2026-07-12, per Maro's
    Navisworks reference — first the toolbar screenshot, then the fuller
    "3D Notations" property-panel one that showed all three as the same
    kind of spatial marker, listed together). A note pinned to a point in
    world space:

    - kind="placemark": free-floating, no leader line.
    - kind="comment": optionally points a leader line at one mesh/IFC
      element (source_kind/element_ref, same loose-identity convention as
      ModelElementLink — see model_element_link.py's own docstring for why
      this is a string ref rather than an FK: it needs to survive a
      re-import of its target the same way a schedule link does). Always
      null for kind="placemark". Comment started this session as its own
      table attached to a saved CameraView, no 3D position at all — the
      fuller reference screenshot showed that was the wrong shape (Comment
      sits in the same "3D Notations" list as the other two, with the same
      property grid), so it was folded in here as a second kind instead.

    kind="footnote" existed briefly alongside "comment" as a third kind —
    scrapped (2026-08-06, per Maro: "scrap footnote as its basically just
    comment") once it turned out the *only* functional difference was a
    review-workflow status field meaningful for one and not the other; an
    Alembic data migration folded every existing footnote row into
    "comment" the same session this was removed. That status field
    ("open"/"resolved") was itself scrapped shortly after (2026-07-30, per
    Maro: "remove the resolved comment feature") — Comment carries no
    review-workflow state of its own any more, it is purely a spatial note.

    Animated the exact same dual-mode way Follow Path's PathFollower is
    (path_follower.py's own docstring) — reusing the two polymorphic tables
    that already carry Mode A/B data rather than building a third animation
    system: source_kind="annotation"/element_ref=this row's own id on both
    ElementKeyframe (manual position/visible keyframes) and ModelElementLink
    (linking to an Activity's own AnimationProfile). See Viewport3D.tsx's
    AnnotationMarker for exactly how this gets resolved — deliberately its
    own small per-marker useFrame, not folded into TimelinePlayback's
    central resolver, since a marker is an Html overlay with no Object3D
    material for that resolver's own machinery to touch.

    icon is a small fixed set owned by the frontend (pin/flag/comment/
    warning), not a custom-uploaded image — v1 scope, revisit if asked.

    Style fields (2026-07-12, matching the reference's own Design/Colors
    property grid) — has_background/background_color/border_color/
    thick_border/text_color/font_size — own how the always-visible callout
    box (comment) or pin (placemark) actually renders; see
    AnnotationMarker.tsx for the exact mapping. background_color replaces
    this table's original single `color` field (renamed same migration —
    no real production data existed yet to preserve, this was still
    same-session unshipped work).

    hide_closer_than/hide_farther_than (2026-07-12, matching the
    reference's own Behavior > Hide if closer/farther than) — world-unit
    camera-distance culling, applied every frame in AnnotationMarker.tsx
    alongside its Mode A/B-resolved visibility. Null means that bound is
    off, same "null = disabled" convention AnimationProfileConfig's own
    duration_frames already uses.

    visible is this annotation's own live-viewport helper visibility
    (independent of Mode A/B animation and of the distance-culling above)
    — same visible/active-style split SectionBox and Path already have for
    their own helpers.

    box_shape (2026-07-30, per Maro: "allow me to pick a standard rectangle
    shape") — "rounded" (default, the original fixed look) | "rectangle"
    (sharp corners) for the comment callout box; see AnnotationMarker.tsx's
    boxBorderRadius for the actual radius each maps to. Meaningless for
    kind="placemark" (its balloon-pin shape is fixed).

    leader_offset_x/y/z (2026-08-06, per Maro: "how the leader works... needs
    some work" — the leader used to be a fixed vertical stem straight up
    from the anchor/target, with no way to offset the callout sideways) —
    a real CAD-style bent leader now: from the effective target (the bound
    element's own live position if source_kind/element_ref is set, else
    this row's own position_x/y/z) up by leader_offset_y to an elbow, then
    horizontally by leader_offset_x/z to the callout box. x/z can be
    dragged in the viewport (AnnotationMarker.tsx's own leader handle,
    constrained to the horizontal plane at the elbow's height) *or* typed
    directly (2026-07-30, per Maro: "i'd like to be able to move
    right/left" too, not just via drag) — y has always been numeric-only,
    same "Elevation" convention Zone's own single scalar already uses.

    leader_visible (2026-07-30, per Maro: "hide the leader completely to
    show just the text box if i want") — independent of animate/reveal
    above: when off, the connecting line never renders at all, but the
    callout box and anchor dot are untouched (the exact opposite split
    from animate's own "gate everything as one unit" — this is
    specifically for a user who wants a floating label with no visible
    line to its target, not a temporary reveal state).

    Defaults (2026-08-06, revised same session, per Maro's own reference
    screenshot — a "NOISE SENSITIVE AREA"-style callout sitting level with
    its target, offset sideways, connected by a near-horizontal line, not
    floating high above it) — (2.0, 0.0, 0.0): a sideways offset with *no*
    rise, not the originally-shipped (0, 0.6, 0) fixed-stem-style default
    this replaced within the same session (existing rows created under the
    old default keep whatever they already have — this only changes what a
    *newly created* annotation starts out looking like).

    animate/animation_loop (2026-08-06, per Maro: "how the leader works and
    how its animated"; scope corrected 2026-07-30, per Maro: "the animate
    leader feature is not just about the leader its the whole thing") — a
    reveal for the *entire* annotation (callout box and anchor dot together
    with the connecting line — not the line alone, which is what this
    originally, wrongly, shipped as), independent of Mode A/B position
    animation and of any scheduled Activity: reuses ElementKeyframe's
    existing anim_start/anim_end fields (source_kind="annotation", same
    convention path.py/zone.py's own animate/animation_loop pair already
    established for Path/Zone — renamed from animate_leader/
    leader_animation_loop same session as the scope fix, to match), so it
    shows up in the Animation Timeline's own dope-sheet and keys off the
    playhead via a Key button, not a schedule. Before the reveal window
    starts nothing is visible at all; the line draws in progressively over
    the window while the box and dot simply appear the moment it starts,
    same "gated as one unit" behaviour AnnotationMarker.tsx's own useFrame
    applies to groupRef/htmlRef together, not just leaderLineRef.

    leader_dot_radius/leader_color/leader_rotation/leader_scale (2026-07-30,
    per Maro, pointing at a Blender GeometryNodes callout modifier's own
    control panel — "Ball Radius"/"Color Stem"/"Rotate Callout"/"Scale
    Callout" — and asking for "everything": "the leader, the point,
    everything") — only meaningful for kind="comment":
    - leader_dot_radius: world-unit radius of the small sphere at the
      leader's target (was a hardcoded 0.06 for every comment; matches
      Blender's own "Ball Radius").
    - leader_color: the connecting line's own colour, independent of
      border_color (which used to double as the line colour too — kept as
      border_color's own value via a same-migration data copy, so no
      existing row's rendered look changes).
    - leader_rotation/leader_scale: rotate (degrees) / scale (multiplier)
      of the callout *box itself* around its own anchor point (where the
      leader line actually touches it — see AnnotationMarker.tsx's own
      2026-07-30 fix for why that's the bottom-left corner), applied as a
      plain CSS transform on the box's own Html div. Deliberately NOT a
      3D transform of the line/dot too — Blender's own callout is itself a
      flat, camera-facing 2D overlay (a compositing-style annotation, not
      a real 3D object), so "rotate/scale the callout" there already only
      ever meant the flat box+text, which is the same thing our Html
      overlay already is; rotating the actual 3D bent leader would need a
      rotation *axis* Blender's own 2D tool never had to choose, and no
      one has asked for that.

    placemark_scale/placemark_rotation (2026-07-30, same request extended
    to Placemark — "and the pin and flag and warning") — only meaningful
    for kind="placemark": scale (multiplier) / rotate (degrees, additive
    to the balloon's own fixed -45° teardrop tilt) around the balloon's
    own tip, i.e. the exact point that touches the 3D anchor — see
    AnnotationMarker.tsx's own placemark transform-origin comment for the
    corner-pivot math (the same technique leader_rotation/leader_scale
    use on the comment box, just applied to a rotated teardrop instead of
    an axis-aligned rectangle).

    background_opacity (2026-07-30, per Maro: "opacity controls for the
    background fill") — 0..1 multiplier on background_color, applied only
    while has_background is on (same "boolean gate, then a real 0..1 dial
    once it's on" split Zone's own fill_opacity already established,
    rather than replacing the boolean outright)."""

    __tablename__ = "annotations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "placemark" | "comment"
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)
    position_z: Mapped[float] = mapped_column(Float, nullable=False)
    source_kind: Mapped[str | None] = mapped_column(String(10), nullable=True)  # "ifc" | "mesh" | null
    element_ref: Mapped[str | None] = mapped_column(String(300), nullable=True)
    text: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    icon: Mapped[str] = mapped_column(String(20), nullable=False, default="pin")
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    has_background: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    background_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#f59e0b")
    background_opacity: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    border_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#ffffff")
    thick_border: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    text_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#111827")
    font_size: Mapped[int] = mapped_column(Integer, nullable=False, default=14)
    hide_closer_than: Mapped[float | None] = mapped_column(Float, nullable=True)
    hide_farther_than: Mapped[float | None] = mapped_column(Float, nullable=True)
    box_shape: Mapped[str] = mapped_column(String(12), nullable=False, default="rounded")  # "rounded" | "rectangle"
    leader_offset_x: Mapped[float] = mapped_column(Float, nullable=False, default=2.0)
    leader_offset_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    leader_offset_z: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    leader_visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    animate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    animation_loop: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    leader_dot_radius: Mapped[float] = mapped_column(Float, nullable=False, default=0.06)
    leader_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#ffffff")
    leader_rotation: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    leader_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    placemark_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    placemark_rotation: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
