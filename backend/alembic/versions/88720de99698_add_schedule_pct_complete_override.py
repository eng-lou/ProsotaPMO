"""add schedule_pct_complete_override

Revision ID: 88720de99698
Revises: 43fdded125d2
Create Date: 2026-09-05 23:04:19.771294

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '88720de99698'
down_revision: Union[str, None] = '43fdded125d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activities', sa.Column('schedule_pct_complete_override', sa.Numeric(precision=12, scale=8), nullable=True))


def downgrade() -> None:
    op.drop_column('activities', 'schedule_pct_complete_override')
