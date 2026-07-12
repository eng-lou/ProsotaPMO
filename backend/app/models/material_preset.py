from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# Mirrors frontend/src/modules/fourD/materialPresets.ts's MaterialPresetConfig
# exactly. Each of the six PBR slots (2026-07-11: aoMap/displacementMap
# joined the original four) is either null (that slot isn't part of this
# preset — applying it leaves that channel alone) or {data_uri, name}: the
# uploaded image re-encoded as a base64 data: URI, directly usable as a
# THREE.TextureLoader source with no separate file-serving endpoint needed
# (same reasoning as every other config blob in this app — stored as one
# opaque JSONB unit, shape owned by the frontend). name is the original
# filename, shown in the editor so re-opening a saved preset doesn't just
# show anonymous thumbnails.
DEFAULT_CONFIG = {
    "map": None,
    "metalnessMap": None,
    "roughnessMap": None,
    "normalMap": None,
    "aoMap": None,
    "displacementMap": None,
}


class MaterialPreset(Base, TimestampMixin):
    """A named, saved, reusable set of PBR texture maps (2026-07-09, per
    Maro: "Save the default materials for the whole model... I can then add
    a new preset which allows me to change the materials, i can save it,
    edit and delete. So if i choose i can toggle between different
    materials I've saved and apply the one i want while not losing the
    original ones").

    Applied on demand to whichever object/element is currently active in
    the viewport (frontend concern — this table only stores the reusable
    recipe itself, same as AnimationProfile). Plain CRUD, no is_active/apply
    concept — a preset isn't "the one active look" for a project, it's a
    library entry the frontend applies per-element via its own
    customTextures override mechanism, and multiple presets can be tried
    without losing anything: the *original* imported material is captured
    separately, client-side, in each mesh's own userData at import time
    (frontend/src/modules/fourD/elementBaseline.ts's originalMaterial
    sibling), never touched by applying/switching presets."""

    __tablename__ = "material_presets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=lambda: dict(DEFAULT_CONFIG))
