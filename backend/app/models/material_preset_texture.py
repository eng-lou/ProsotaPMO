from __future__ import annotations

import uuid

from sqlalchemy import BigInteger, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class MaterialPresetTexture(Base, TimestampMixin):
    """One texture image belonging to a MaterialPreset's slot (2026-07-13,
    per a real incident: a preset with a genuine 8K texture failed to save
    — `total size of jsonb object elements exceeds the maximum of
    268435455 bytes`, Postgres's own hard 256MB-per-JSONB-element ceiling.
    MaterialPreset.config previously stored each slot's image as an inline
    base64 data: URI directly in that JSONB column; three real presets
    already had genuine image data saved that way before this table
    existed (up to 247MB of base64 in one row) — see this migration's own
    data-extraction step, not just a schema change.

    Same local-disk storage as Model3DFile (model3d_storage.py's own
    generate_storage_filename/storage_path/delete_stored_file, reused
    directly here, not reimplemented) — only metadata lives in Postgres,
    the actual bytes live on disk under settings.model3d_storage_dir.

    One row per (preset, slot) — a slot conceptually always holds 0 or 1
    image; a fresh upload to an already-filled slot replaces the row
    (deletes the old disk file first), matching Model3DFile's own
    replace-on-same-name behaviour in create_file."""

    __tablename__ = "material_preset_textures"
    __table_args__ = (
        UniqueConstraint("preset_id", "slot", name="uq_material_preset_textures_preset_slot"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    preset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("material_presets.id", ondelete="CASCADE"), nullable=False)
    slot: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    storage_filename: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
