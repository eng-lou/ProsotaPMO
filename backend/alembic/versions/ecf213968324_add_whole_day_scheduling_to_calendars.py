"""add whole_day_scheduling to calendars

Revision ID: ecf213968324
Revises: 78b94b1c8837
Create Date: 2026-07-13 19:04:12.285087

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'ecf213968324'
down_revision: Union[str, None] = '78b94b1c8837'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default backfills every existing calendar row to off (the
    # correct value — hour-precision unchanged) before the NOT NULL
    # constraint applies; dropped right after so new rows rely on the
    # ORM-side default instead, same pattern already used elsewhere in
    # this migration history for a new non-nullable boolean column.
    op.add_column('calendars', sa.Column('whole_day_scheduling', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('calendars', 'whole_day_scheduling', server_default=None)
    # Note: autogenerate also detected several unrelated unique-constraint
    # metadata differences (cost_elements/cost_variance_criteria/
    # icd_criteria/icd_items/risk_impact_criteria/
    # risk_mitigation_actions/risk_probability_criteria/risks) — pre-existing
    # drift unrelated to this change (a postgresql_nulls_not_distinct
    # comparison quirk), deliberately left out of this migration.


def downgrade() -> None:
    op.drop_column('calendars', 'whole_day_scheduling')
