"""add activities.units_pct_complete

Revision ID: a2c7e4f9b381
Revises: f3a8b1d0c264
Create Date: 2026-09-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a2c7e4f9b381'
down_revision: Union[str, None] = 'f3a8b1d0c264'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activities', sa.Column('units_pct_complete', sa.Numeric(12, 8), nullable=True))


def downgrade() -> None:
    op.drop_column('activities', 'units_pct_complete')
