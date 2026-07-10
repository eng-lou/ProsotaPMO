"""add print font family fields to project letterhead

Revision ID: 5b42eadbec23
Revises: 87fbbae0d0a1
Create Date: 2026-07-07 12:51:50.185263

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5b42eadbec23'
down_revision: Union[str, None] = '87fbbae0d0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate also proposed dropping/recreating several unrelated unique
    # constraints elsewhere (cost/risk/icd tables) — the same metadata-
    # rendering difference as the last several migrations before this one,
    # not a real schema change; stripped out.
    op.add_column('project_letterheads', sa.Column('print_font_family', sa.String(length=10), nullable=False, server_default='sans'))
    op.add_column('project_letterheads', sa.Column('gantt_print_font_family', sa.String(length=10), nullable=False, server_default='sans'))


def downgrade() -> None:
    op.drop_column('project_letterheads', 'gantt_print_font_family')
    op.drop_column('project_letterheads', 'print_font_family')
