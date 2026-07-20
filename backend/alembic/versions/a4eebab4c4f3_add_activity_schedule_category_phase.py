"""add activity schedule_category/schedule_phase_key

Revision ID: a4eebab4c4f3
Revises: 8664ecf11b8a
Create Date: 2026-07-17 19:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a4eebab4c4f3'
down_revision: Union[str, None] = '8664ecf11b8a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activities', sa.Column('schedule_category', sa.String(length=100), nullable=True))
    op.add_column('activities', sa.Column('schedule_phase_key', sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column('activities', 'schedule_phase_key')
    op.drop_column('activities', 'schedule_category')
