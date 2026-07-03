"""period data date time

Revision ID: 209505f9739f
Revises: 90064aca680c
Create Date: 2026-07-03 23:22:08.420853

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '209505f9739f'
down_revision: Union[str, None] = '90064aca680c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Note: autogenerate also flagged several pre-existing unique constraints as
    # "removed" (models never declared them via __table_args__) — left alone,
    # out of scope for this migration (see 00a26a304901's own note).
    op.add_column('periods', sa.Column('start_time', sa.Time(), nullable=True))


def downgrade() -> None:
    op.drop_column('periods', 'start_time')
