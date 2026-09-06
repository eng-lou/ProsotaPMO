"""drop schedule_pct_complete_override and duration_pct_complete_date

Revision ID: ea686aad762e
Revises: 88720de99698
Create Date: 2026-09-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'ea686aad762e'
down_revision: Union[str, None] = '88720de99698'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('activities', 'schedule_pct_complete_override')
    op.drop_column('activities', 'duration_pct_complete_date')


def downgrade() -> None:
    op.add_column('activities', sa.Column('duration_pct_complete_date', sa.Date(), nullable=True))
    op.add_column('activities', sa.Column('schedule_pct_complete_override', sa.Numeric(precision=12, scale=8), nullable=True))
