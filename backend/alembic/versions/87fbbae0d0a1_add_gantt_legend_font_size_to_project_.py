"""add gantt legend font size to project letterhead

Revision ID: 87fbbae0d0a1
Revises: 03cf5581d03a
Create Date: 2026-07-07 11:48:28.248490

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '87fbbae0d0a1'
down_revision: Union[str, None] = '03cf5581d03a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate also proposed dropping/recreating several unrelated unique
    # constraints elsewhere (cost/risk/icd tables) — the same metadata-
    # rendering difference as the last few migrations before this one, not a
    # real schema change; stripped out.
    op.add_column('project_letterheads', sa.Column('gantt_legend_font_size', sa.Integer(), nullable=False, server_default='9'))


def downgrade() -> None:
    op.drop_column('project_letterheads', 'gantt_legend_font_size')
