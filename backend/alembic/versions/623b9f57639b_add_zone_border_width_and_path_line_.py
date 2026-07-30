"""add zone border_width and path line_width

Revision ID: 623b9f57639b
Revises: 6c1cb5fc35e6
Create Date: 2026-07-29 13:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '623b9f57639b'
down_revision: Union[str, None] = '6c1cb5fc35e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default matches each column's own Python-side default exactly
    # (zone.py's border_width, path.py's line_width) — both 2, the same
    # hardcoded lineWidth ZoneGizmo.tsx/PathGizmo.tsx already used before
    # this migration, so an existing zone/path renders unchanged.
    op.add_column('zones', sa.Column('border_width', sa.Integer(), nullable=False, server_default='2'))
    op.add_column('paths', sa.Column('line_width', sa.Integer(), nullable=False, server_default='2'))


def downgrade() -> None:
    op.drop_column('paths', 'line_width')
    op.drop_column('zones', 'border_width')
