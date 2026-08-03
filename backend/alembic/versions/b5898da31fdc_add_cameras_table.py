"""add cameras table

Revision ID: b5898da31fdc
Revises: a3b8f6d1c024
Create Date: 2026-08-03 21:17:05.903606

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b5898da31fdc'
down_revision: Union[str, None] = 'a3b8f6d1c024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# NOTE: hand-trimmed from the raw --autogenerate output (2026-08-03) — the
# raw diff also included a handful of unrelated drops (a `zones` table
# drop, several unique-constraint drops on cost/icd/risk tables, a
# radial_charts index add) that have nothing to do with this migration.
# Those come from a pre-existing gap where Zone isn't imported in
# app/models/__init__.py, so Alembic's autogenerate can't see it and
# thinks it should be dropped — a real bug, but a separate one; applying
# that here would have actually dropped the live zones table. Only the
# intended change (the new `cameras` table) is kept below.
def upgrade() -> None:
    op.create_table('cameras',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=300), nullable=False),
    sa.Column('base_position_x', sa.Float(), nullable=False),
    sa.Column('base_position_y', sa.Float(), nullable=False),
    sa.Column('base_position_z', sa.Float(), nullable=False),
    sa.Column('base_target_x', sa.Float(), nullable=False),
    sa.Column('base_target_y', sa.Float(), nullable=False),
    sa.Column('base_target_z', sa.Float(), nullable=False),
    sa.Column('base_focal_length', sa.Float(), nullable=False),
    sa.Column('base_clip_start', sa.Float(), nullable=False),
    sa.Column('base_clip_end', sa.Float(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_cameras_project_id'), 'cameras', ['project_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_cameras_project_id'), table_name='cameras')
    op.drop_table('cameras')
