from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Annotation(Base, TimestampMixin):
    """A Placemark, Footnote, or Comment in the 4D viewport (2026-07-12, per
    Maro's Navisworks reference — first the toolbar screenshot, then the
    fuller "3D Notations" property-panel one that showed all three as the
    same kind of spatial marker, listed together). A note pinned to a point
    in world space:

    - kind="placemark": free-floating, no leader line.
    - kind="footnote"/"comment": optionally points a leader line at one
      mesh/IFC element (source_kind/element_ref, same loose-identity
      convention as ModelElementLink — see model_element_link.py's own
      docstring for why this is a string ref rather than an FK: it needs to
      survive a re-import of its target the same way a schedule link does).
      Always null for kind="placemark". Comment started this session as its
      own table attached to a saved CameraView, no 3D position at all — the
      fuller reference screenshot showed that was the wrong shape (Comment
      sits in the same "3D Notations" list as the other two, with the same
      property grid), so it was folded in here as a third kind instead.

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
    box (footnote/comment) or pin (placemark) actually renders; see
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

    status (2026-07-12, per Maro: "so what's the difference [between
    Comment and Footnote]" — a fair question, since without this they were
    functionally identical) — "open"|"resolved", a review-workflow flag
    only meaningful for kind="comment" (same "only some kinds use this
    column" precedent source_kind/element_ref already set for
    footnote/comment vs. placemark). A Footnote is a permanent technical
    callout with nothing to resolve; a Comment is a review note you close
    out once it's addressed."""

    __tablename__ = "annotations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "placemark" | "footnote" | "comment"
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
    border_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#ffffff")
    thick_border: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    text_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#111827")
    font_size: Mapped[int] = mapped_column(Integer, nullable=False, default=14)
    hide_closer_than: Mapped[float | None] = mapped_column(Float, nullable=True)
    hide_farther_than: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")  # "open" | "resolved"
