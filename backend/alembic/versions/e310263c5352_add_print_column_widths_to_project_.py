"""add print column widths to project letterhead

Revision ID: e310263c5352
Revises: bcd42067f011
Create Date: 2026-07-07 10:42:08.701703

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e310263c5352'
down_revision: Union[str, None] = 'bcd42067f011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate also proposed dropping/recreating several unrelated unique
    # constraints elsewhere (cost/risk/icd tables) — a metadata-rendering
    # difference (postgresql_nulls_not_distinct) versus the live DB, not a
    # real schema change this migration intends; stripped out, same as
    # bcd42067f011 (add_user_defined_fields) just before this one.
    #
    # server_default='{}' (not just the ORM's default=dict) so this NOT NULL
    # column can be added to a table that may already have rows.
    op.add_column('project_letterheads', sa.Column(
        'print_column_widths', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'
    ))
    op.add_column('project_letterheads', sa.Column('print_udf_column_width', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('project_letterheads', 'print_udf_column_width')
    op.drop_column('project_letterheads', 'print_column_widths')
