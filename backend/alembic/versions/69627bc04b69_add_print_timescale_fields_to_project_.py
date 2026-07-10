"""add print timescale fields to project_letterheads

Revision ID: 69627bc04b69
Revises: 4f762dfc9b9f
Create Date: 2026-07-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '69627bc04b69'
down_revision: Union[str, None] = '4f762dfc9b9f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('project_letterheads', sa.Column('timescale_start_mode', sa.String(length=10), nullable=False, server_default='auto'))
    op.add_column('project_letterheads', sa.Column('timescale_finish_mode', sa.String(length=10), nullable=False, server_default='auto'))
    op.add_column('project_letterheads', sa.Column('timescale_start_custom_date', sa.Date(), nullable=True))
    op.add_column('project_letterheads', sa.Column('timescale_finish_custom_date', sa.Date(), nullable=True))
    op.alter_column('project_letterheads', 'timescale_start_mode', server_default=None)
    op.alter_column('project_letterheads', 'timescale_finish_mode', server_default=None)


def downgrade() -> None:
    op.drop_column('project_letterheads', 'timescale_finish_custom_date')
    op.drop_column('project_letterheads', 'timescale_start_custom_date')
    op.drop_column('project_letterheads', 'timescale_finish_mode')
    op.drop_column('project_letterheads', 'timescale_start_mode')
