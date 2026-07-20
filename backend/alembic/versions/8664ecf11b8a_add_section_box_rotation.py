"""add section box rotation

Revision ID: 8664ecf11b8a
Revises: d1d242eaf490
Create Date: 2026-07-17 15:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8664ecf11b8a'
down_revision: Union[str, None] = 'd1d242eaf490'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default='0' so every existing row backfills to an unrotated
    # (axis-aligned, same as today) box rather than nullable/NULL — matches
    # this table's own other float columns, all NOT NULL.
    op.add_column('section_boxes', sa.Column('rot_x', sa.Float(), nullable=False, server_default='0'))
    op.add_column('section_boxes', sa.Column('rot_y', sa.Float(), nullable=False, server_default='0'))
    op.add_column('section_boxes', sa.Column('rot_z', sa.Float(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('section_boxes', 'rot_z')
    op.drop_column('section_boxes', 'rot_y')
    op.drop_column('section_boxes', 'rot_x')
