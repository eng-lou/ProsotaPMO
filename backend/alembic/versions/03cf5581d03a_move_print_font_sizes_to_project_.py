"""move print font sizes to project letterhead

Revision ID: 03cf5581d03a
Revises: e310263c5352
Create Date: 2026-07-07 11:10:35.216969

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '03cf5581d03a'
down_revision: Union[str, None] = 'e310263c5352'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate also proposed dropping/recreating several unrelated unique
    # constraints elsewhere (cost/risk/icd tables) — a metadata-rendering
    # difference (postgresql_nulls_not_distinct) versus the live DB, not a
    # real schema change this migration intends; stripped out, same as the
    # last two migrations before this one.
    #
    # server_default matches GanttStyle's own previous defaults (9/9/8) so
    # this NOT NULL column can be added to a table that may already have
    # rows, and every existing project's print output is unchanged.
    op.add_column('project_letterheads', sa.Column('print_font_size', sa.Integer(), nullable=False, server_default='9'))
    op.add_column('project_letterheads', sa.Column('header_print_font_size', sa.Integer(), nullable=False, server_default='9'))
    op.add_column('project_letterheads', sa.Column('gantt_print_font_size', sa.Integer(), nullable=False, server_default='8'))


def downgrade() -> None:
    op.drop_column('project_letterheads', 'gantt_print_font_size')
    op.drop_column('project_letterheads', 'header_print_font_size')
    op.drop_column('project_letterheads', 'print_font_size')
