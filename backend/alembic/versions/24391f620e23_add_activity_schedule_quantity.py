"""add activity schedule_quantity

Revision ID: 24391f620e23
Revises: 18a5d2e28cef
Create Date: 2026-07-18 13:17:44.345754

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '24391f620e23'
down_revision: Union[str, None] = '18a5d2e28cef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate also proposed dropping/recreating several unrelated
    # unique constraints — pure SQLAlchemy-reflection drift
    # (postgresql_nulls_not_distinct comparison), same as the last two
    # migrations; trimmed to just the one real change.
    op.add_column('activities', sa.Column('schedule_quantity', sa.Numeric(precision=14, scale=2), nullable=True))


def downgrade() -> None:
    op.drop_column('activities', 'schedule_quantity')
