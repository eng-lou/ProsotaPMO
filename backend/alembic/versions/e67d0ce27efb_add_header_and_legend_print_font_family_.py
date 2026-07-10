"""add header and legend print font family fields

Revision ID: e67d0ce27efb
Revises: 5b42eadbec23
Create Date: 2026-07-07 13:30:54.157407

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e67d0ce27efb'
down_revision: Union[str, None] = '5b42eadbec23'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate also proposed dropping/recreating several unrelated unique
    # constraints elsewhere (cost/risk/icd tables) — the same metadata-
    # rendering difference as the last several migrations before this one,
    # not a real schema change; stripped out.
    op.add_column('project_letterheads', sa.Column('header_print_font_family', sa.String(length=10), nullable=False, server_default='sans'))
    op.add_column('project_letterheads', sa.Column('gantt_legend_font_family', sa.String(length=10), nullable=False, server_default='sans'))


def downgrade() -> None:
    op.drop_column('project_letterheads', 'gantt_legend_font_family')
    op.drop_column('project_letterheads', 'header_print_font_family')
