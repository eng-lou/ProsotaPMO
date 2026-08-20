"""add app_settings table

Revision ID: feda037157c4
Revises: 48d18a4cf8fe
Create Date: 2026-08-19 15:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'feda037157c4'
down_revision: Union[str, None] = '48d18a4cf8fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# NOTE: hand-trimmed from the raw --autogenerate output (2026-08-19), same
# reason as b5898da31fdc_add_cameras_table.py's own note — the raw diff
# also included a batch of unrelated unique-constraint drops (cost/icd/risk
# tables) and index adds (radial_charts, zones) that pre-date this change
# and have nothing to do with it. Only the intended change (the new
# `app_settings` table) is kept below.
def upgrade() -> None:
    op.create_table('app_settings',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('google_tiles_api_key', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('app_settings')
