"""add activities.duration_pct_complete

Revision ID: d9e2c5a4f716
Revises: b4d1f3a8e921
Create Date: 2026-09-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd9e2c5a4f716'
down_revision: Union[str, None] = 'b4d1f3a8e921'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activities', sa.Column('duration_pct_complete', sa.Numeric(9, 8), nullable=True))
    op.add_column('activities', sa.Column('duration_pct_complete_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('activities', 'duration_pct_complete_date')
    op.drop_column('activities', 'duration_pct_complete')
