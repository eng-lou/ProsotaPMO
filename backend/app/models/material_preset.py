from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


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
    sibling), never touched by applying/switching presets.

    Each of the six PBR slots' actual image lives in a MaterialPresetTexture
    row (material_preset_texture.py), not inline here — this table used to
    hold every slot as a base64 data: URI directly in a `config` JSONB
    column, which a real 8K texture blew straight through Postgres's own
    256MB-per-JSONB-element ceiling on (2026-07-13 fix, see that model's own
    docstring for the full incident and the one-time data migration that
    extracted the presets that had already saved real data that way)."""

    __tablename__ = "material_presets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
