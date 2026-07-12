from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class PathFollower(Base, TimestampMixin):
    """Binds one target (the camera, or a mesh/IFC element) to a Path
    (path.py) — Blender's own "Follow Path" constraint (2026-07-11, per
    Maro: "i can then place an object to follow that path... You've kinda
    done something similar with the profile but this is a bit different").

    Deliberately a *separate* row from ElementKeyframe, not a new field
    tacked onto it — this table is the structural "which path is X bound
    to" relationship (rare to change, one row per bound target); *how far
    along that path over time* is a completely different, much
    higher-frequency concern (many keyframes over a timeline), which
    reuses ElementKeyframe's own existing date-keyed machinery unchanged
    via a new field="path_progress" (element_keyframe.py's own schema —
    KeyframeField) rather than inventing a second date-keyed value store
    for what's structurally the exact same shape (a field on a target,
    interpolated between keyframed dates). Follow Path's own two concerns
    — "which curve" and "how far along it, when" — split the same way in
    Blender itself: the constraint references a curve object; the
    constraint's own Offset value is what actually gets keyframed.

    target_kind mirrors ElementKeyframe/ModelElementLink's own
    source_kind, with one addition: "camera" — the first entity in this app
    that isn't a mesh/IFC element at all, since until now there was no
    persistent Camera object to bind anything to (Viewport3D.tsx's camera
    was always just an implicit orbit-controlled viewpoint). element_ref is
    a real GlobalId/filename for a mesh/ifc target, or "" (empty string,
    never NULL — see this table's own UniqueConstraint below) for "camera",
    since there's only ever one camera to bind.

    orient_to_path (2026-07-11) — Blender's own Follow Path "Follow Curve"
    option: when on, the target's rotation is set to face the curve's own
    tangent direction at its current point, not just translated along it;
    off leaves rotation untouched (still driven by whatever its own
    rot_x/y/z keyframes or baseline say, same as an object with no path
    binding at all)."""

    __tablename__ = "path_followers"
    __table_args__ = (
        # One binding per target at a time (2026-07-11) — matches Blender's
        # own single Follow Path constraint slot per object in the common
        # case; a target already bound to a path gets re-pointed by
        # updating this row's path_id, not by adding a second follower
        # that would leave two path constraints silently fighting over the
        # same position every frame. element_ref is never NULL (see the
        # model's own docstring on why "camera" stores "" instead) —
        # Postgres treats every NULL as distinct for uniqueness purposes,
        # which would have silently let multiple "camera" rows coexist if
        # this had allowed NULL here instead of "".
        UniqueConstraint("project_id", "target_kind", "element_ref", name="uq_path_followers_target"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    path_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("paths.id", ondelete="CASCADE"), nullable=False)
    target_kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "camera" | "mesh" | "ifc"
    element_ref: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    orient_to_path: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
