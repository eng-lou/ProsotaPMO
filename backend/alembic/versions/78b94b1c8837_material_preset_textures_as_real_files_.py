"""material preset textures as real files, migrate embedded data

Revision ID: 78b94b1c8837
Revises: 67c8a435d12f
Create Date: 2026-07-13 11:08:27.425102

A real incident (2026-07-13): saving a Material Preset with a genuine 8K
texture failed with `total size of jsonb object elements exceeds the
maximum of 268435455 bytes` — the base64-encoded image alone was ~300MB,
and Postgres refuses to store any single JSONB element over 256MB.
material_presets.config previously held every slot's image inline as a
base64 data: URI; this migration gives each slot its own row in the new
material_preset_textures table (real files on local disk, same pattern
Model3DFile already uses) instead.

This is NOT just a schema change — three real presets already had genuine
image data saved the old way (confirmed via direct query before writing
this: 'conc' ~77MB config, 'concrete dirty' ~247MB, 'Metal' ~128MB), so the
data step below decodes and extracts each one to a real file *before*
config is dropped, one preset at a time (not the whole table in memory at
once, given those sizes). The downgrade only reverses the schema, not the
data extraction — re-embedding files back into JSONB isn't safe to do
automatically for the same reason storing them there broke in the first
place, so a downgrade after this migration has actually run is a one-way
door for the data specifically, not just the schema.
"""
import base64
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '78b94b1c8837'
down_revision: Union[str, None] = '67c8a435d12f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SLOTS = ["map", "metalnessMap", "roughnessMap", "normalMap", "aoMap", "displacementMap"]


def _migrate_embedded_textures() -> None:
    # Deliberately does its own minimal storage-path resolution rather than
    # importing app.services.model3d_storage — that module can evolve after
    # this migration is written and merged; a historical data migration
    # should keep behaving exactly as it did the day it ran, not silently
    # change if that module's own logic changes later. Mirrors its current
    # logic exactly (uuid4 + original extension, under settings.
    # model3d_storage_dir) at the moment this migration was authored.
    from pathlib import Path
    from app.core.config import settings

    storage_dir = Path(settings.model3d_storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)

    bind = op.get_bind()
    presets_table = sa.table(
        "material_presets", sa.column("id", postgresql.UUID), sa.column("config", postgresql.JSONB),
    )
    textures_table = sa.table(
        "material_preset_textures",
        sa.column("id", postgresql.UUID), sa.column("preset_id", postgresql.UUID),
        sa.column("slot", sa.String), sa.column("name", sa.String),
        sa.column("storage_filename", sa.String), sa.column("size_bytes", sa.BigInteger),
    )

    presets = bind.execute(sa.select(presets_table.c.id, presets_table.c.config)).fetchall()
    for preset_id, config in presets:
        if not config:
            continue
        for slot in SLOTS:
            slot_value = config.get(slot)
            if not slot_value or not slot_value.get("data_uri"):
                continue
            data_uri: str = slot_value["data_uri"]
            original_name: str = slot_value.get("name") or slot
            # "data:image/jpeg;base64,AAAA..." -> the base64 payload alone.
            _, _, b64_payload = data_uri.partition(",")
            raw_bytes = base64.b64decode(b64_payload)

            ext = "".join(Path(original_name).suffixes) or ""
            storage_filename = f"{uuid.uuid4()}{ext}"
            (storage_dir / storage_filename).write_bytes(raw_bytes)

            bind.execute(textures_table.insert().values(
                id=uuid.uuid4(), preset_id=preset_id, slot=slot, name=original_name,
                storage_filename=storage_filename, size_bytes=len(raw_bytes),
            ))


def upgrade() -> None:
    op.create_table('material_preset_textures',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('preset_id', sa.UUID(), nullable=False),
    sa.Column('slot', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=300), nullable=False),
    sa.Column('storage_filename', sa.String(length=300), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['preset_id'], ['material_presets.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('preset_id', 'slot', name='uq_material_preset_textures_preset_slot'),
    sa.UniqueConstraint('storage_filename')
    )

    _migrate_embedded_textures()

    op.drop_column('material_presets', 'config')


def downgrade() -> None:
    # See this file's own module docstring — schema-only, does not restore
    # the extracted image bytes back into config.
    op.add_column('material_presets', sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False, server_default='{}'))
    op.alter_column('material_presets', 'config', server_default=None)
    op.drop_table('material_preset_textures')
