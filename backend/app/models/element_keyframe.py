from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ElementKeyframe(Base, TimestampMixin):
    """A single custom keyframe on one Transform field of one imported model
    element, for the 4D timeline (2026-07-11, per Maro: "I want to be able
    to use both [profiles and manual keyframes] to drive more complex
    motions"). Per-field, not per-object — pos_x/pos_y/pos_z/rot_x/rot_y/
    rot_z/scale_x/scale_y/scale_z each keep their own independent set of
    keyframes (matches the individual keyable dot already on each field in
    TransformPanel.tsx), so e.g. rotation can be manually keyed while
    position is left to whatever an assigned AnimationProfile computes.

    Keyed by (project_id, source_kind, element_ref) — the exact same
    identity scheme as ModelElementLink, deliberately *not* an FK to a
    specific link row: a custom motion path is a property of the element
    itself, not of any one particular activity it happens to be linked to
    (an element could in principle link to more than one activity). Also
    deliberately not an FK to Model3DFile (model3d_file.py) — see
    ModelElementLink's own docstring for the fuller rationale (same loose
    string identity, same reason). This only ever means anything once the
    matching file is back in the viewport under the same identifier, and
    like ModelElementLink, a row here can outlive every stored copy of its
    source file — FourD.tsx's requestUnloadModel offers to clean these up
    on Unload, same as it does for links.

    value is always the absolute value the field would show in
    TransformPanel at that date (metres for position, degrees for rotation,
    a raw scale factor for scale) — not an offset — since when a field has
    any keyframes at all, they take over that field entirely (interpolated
    between the two nearest ones) rather than combining with anything else;
    see Viewport3D.tsx's TimelinePlayback for exactly how that split against
    an assigned AnimationProfile's own opacity/colour/transform works.

    v1 scope: only ever written for source_kind="mesh" for ordinary
    Transform fields (pos_x..scale_z) — TransformPanel's "active object"
    selection for an IFC import is always the *whole model* (for
    repositioning it against the site), but IFC links target individual
    sub-elements by GlobalId; those two don't share an identity, so the
    frontend disables keyframing for a selected IFC model rather than fake
    a mapping that doesn't really exist. source_kind is still stored
    per-row (matching ModelElementLink) so this doesn't need a migration if
    that gap closes later.

    source_kind="camera" (2026-07-11, added alongside path_follower.py) is
    the one exception — always element_ref="", used only for the new
    field="path_progress" (camera-path animation), never for ordinary
    Transform fields, since the camera has no TransformPanel of its own to
    key from in the first place."""

    __tablename__ = "element_keyframes"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "source_kind", "element_ref", "field", "date",
            name="uq_element_keyframes_identity",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "ifc" | "mesh"
    element_ref: Mapped[str] = mapped_column(String(300), nullable=False)
    field: Mapped[str] = mapped_column(String(20), nullable=False)  # "pos_x" .. "scale_z"
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
