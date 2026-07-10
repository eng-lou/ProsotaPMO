"""add suspend_date and resume_date to activities

Revision ID: bb11af82cf43
Revises: 9d2aaf984d69
Create Date: 2026-07-07 15:08:14.184335

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'bb11af82cf43'
down_revision: Union[str, None] = '9d2aaf984d69'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activities', sa.Column('suspend_date', sa.DateTime(), nullable=True))
    op.add_column('activities', sa.Column('resume_date', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('activities', 'resume_date')
    op.drop_column('activities', 'suspend_date')
