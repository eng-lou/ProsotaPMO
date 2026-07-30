"""add path style fields (color, line_style, show_arrow, show_label)

Revision ID: 6c1cb5fc35e6
Revises: d5be6138c7e9
Create Date: 2026-07-29 12:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '6c1cb5fc35e6'
down_revision: Union[str, None] = 'd5be6138c7e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default added by hand on every column below (existing paths
    # may already have rows) — values match each column's own Python-side
    # default in path.py exactly. color's default ('#38bdf8') is
    # PathGizmo.tsx's own pre-existing LINE_COLOR constant, so an
    # already-created path renders unchanged after this migration.
    op.add_column('paths', sa.Column('color', sa.String(length=9), nullable=False, server_default='#38bdf8'))
    op.add_column('paths', sa.Column('line_style', sa.String(length=10), nullable=False, server_default='solid'))
    op.add_column('paths', sa.Column('show_arrow', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('paths', sa.Column('show_label', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('paths', 'show_label')
    op.drop_column('paths', 'show_arrow')
    op.drop_column('paths', 'line_style')
    op.drop_column('paths', 'color')
