"""add path and zone reveal animation fields

Revision ID: b0181d1704b6
Revises: 536bdbb087a4
Create Date: 2026-07-29 19:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b0181d1704b6'
down_revision: Union[str, None] = '536bdbb087a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default matches each column's own Python-side default exactly
    # (path.py/zone.py). animate defaults false and animation_start/
    # animation_end/animation_mode are meaningless until it's on, so an
    # existing path/zone renders unchanged before/after this migration —
    # the datetime columns get no server_default at all (NULL is the
    # correct starting value, not any particular date).
    op.add_column('paths', sa.Column('animate', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('paths', sa.Column('animation_start', sa.DateTime(timezone=True), nullable=True))
    op.add_column('paths', sa.Column('animation_end', sa.DateTime(timezone=True), nullable=True))
    op.add_column('paths', sa.Column('animation_loop', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('zones', sa.Column('animate', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('zones', sa.Column('animation_start', sa.DateTime(timezone=True), nullable=True))
    op.add_column('zones', sa.Column('animation_end', sa.DateTime(timezone=True), nullable=True))
    op.add_column('zones', sa.Column('animation_loop', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('zones', sa.Column('animation_mode', sa.String(length=10), nullable=False, server_default='draw'))


def downgrade() -> None:
    op.drop_column('zones', 'animation_mode')
    op.drop_column('zones', 'animation_loop')
    op.drop_column('zones', 'animation_end')
    op.drop_column('zones', 'animation_start')
    op.drop_column('zones', 'animate')
    op.drop_column('paths', 'animation_loop')
    op.drop_column('paths', 'animation_end')
    op.drop_column('paths', 'animation_start')
    op.drop_column('paths', 'animate')
