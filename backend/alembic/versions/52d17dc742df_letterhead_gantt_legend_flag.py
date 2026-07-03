"""letterhead gantt legend flag

Revision ID: 52d17dc742df
Revises: 00a26a304901
Create Date: 2026-07-03 19:44:43.745553

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '52d17dc742df'
down_revision: Union[str, None] = '00a26a304901'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Note: autogenerate also flagged several pre-existing unique constraints as
    # "removed" (models never declared them via __table_args__) — left alone,
    # out of scope for this migration (see 00a26a304901's own note).
    op.add_column('project_letterheads', sa.Column('show_gantt_legend', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('project_letterheads', 'show_gantt_legend')
