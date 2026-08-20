"""add site_context table

Revision ID: 48d18a4cf8fe
Revises: b5898da31fdc
Create Date: 2026-08-19 14:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '48d18a4cf8fe'
down_revision: Union[str, None] = 'b5898da31fdc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# NOTE: hand-trimmed from the raw --autogenerate output (2026-08-19), same
# reason as b5898da31fdc_add_cameras_table.py's own note — the raw diff
# also included a batch of unrelated unique-constraint drops (cost/icd/risk
# tables) and index adds (radial_charts, zones) that pre-date this change
# and have nothing to do with it. Only the intended change (the new
# `site_contexts` table) is kept below.
def upgrade() -> None:
    op.create_table('site_contexts',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('lat', sa.Float(), nullable=True),
    sa.Column('lon', sa.Float(), nullable=True),
    sa.Column('label', sa.String(length=300), nullable=True),
    sa.Column('camera_height_m', sa.Float(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id')
    )


def downgrade() -> None:
    op.drop_table('site_contexts')
