"""add path dash spacing and zone border dash style/spacing

Revision ID: 536bdbb087a4
Revises: 623b9f57639b
Create Date: 2026-07-29 13:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '536bdbb087a4'
down_revision: Union[str, None] = '623b9f57639b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default matches each column's own Python-side default exactly
    # (path.py's dash_size/gap_size, zone.py's border_style/
    # border_dash_size/border_gap_size). border_style default 'solid' means
    # an existing zone's border renders unchanged (it was always solid
    # before this migration, with no dashed option at all).
    op.add_column('paths', sa.Column('dash_size', sa.Float(), nullable=False, server_default='0.5'))
    op.add_column('paths', sa.Column('gap_size', sa.Float(), nullable=False, server_default='0.3'))
    op.add_column('zones', sa.Column('border_style', sa.String(length=10), nullable=False, server_default='solid'))
    op.add_column('zones', sa.Column('border_dash_size', sa.Float(), nullable=False, server_default='0.5'))
    op.add_column('zones', sa.Column('border_gap_size', sa.Float(), nullable=False, server_default='0.3'))


def downgrade() -> None:
    op.drop_column('zones', 'border_gap_size')
    op.drop_column('zones', 'border_dash_size')
    op.drop_column('zones', 'border_style')
    op.drop_column('paths', 'gap_size')
    op.drop_column('paths', 'dash_size')
