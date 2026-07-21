from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# Mirrors frontend/src/modules/fourD/animationProfiles.ts's
# AnimationProfileConfig exactly. "over_duration" (fade/grow across the whole
# task, not an instant flip at start/finish) is the sensible default for the
# common case (new construction).
DEFAULT_CONFIG = {
    "trigger": "over_duration",
    "transform_kind": "none",
    "axis": "z",
    "direction": 1,
    "distance": 1.0,
    "bounce": False,
    "twist": False,
    "opacity_from": 0.0,
    "opacity_to": 1.0,
    "color_from": None,
    "color_to": None,
    "interpolation": "linear",
    "duration_frames": None,
}


class AnimationProfile(Base, TimestampMixin):
    """A named, saved, reusable 4D animation recipe (2026-07-11, per Maro,
    referencing Bonsai's Animation Color Scheme and a separate Blender
    add-on's named preset library — "Pop Up Y", "Fall Down Z", "Spiral In X",
    "Rotate In Bounce -Z", etc.) — assigned to a ModelElementLink (see its
    own animation_profile_id) to drive how that element animates once the
    4D timeline actually plays it back (not built yet — this is the
    reusable-recipe half only).

    Unlike GanttLayout/DockLayout, there's no is_active/apply concept here:
    a profile isn't "the one active look" for a project, it's a library
    entry individually assigned per-link, so plain CRUD is all this needs.

    config is JSONB, not flat columns, for the same reason as GanttLayout's
    style/DockLayout's config — read/written as one unit, shape owned by
    the frontend/whatever eventually consumes it (the timeline playback
    engine), not this table. Built-in presets (the named list above) are
    frontend-only constants, not seeded rows here — "Save as new" from a
    built-in is what turns one into an editable row a project can then
    customise/rename/delete, keeping this table just user-created ones."""

    __tablename__ = "animation_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=lambda: dict(DEFAULT_CONFIG))
