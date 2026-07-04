"""baseline_snapshot_captures_code

Revision ID: c5f2a8b3e916
Revises: b4e1f2a9c7d3
Create Date: 2026-07-04 10:05:00.000000

A saved baseline snapshot (schedule_baseline_activities) previously only
captured start/finish/duration_hours — the code column didn't exist, so
"what was this activity's code when the baseline was captured" was
unanswerable once a code changed (promote/demote or manual rename)
(2026-07-04, per Maro). Backfilled from each activity's current code —
the closest available approximation for snapshots taken before this
column existed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c5f2a8b3e916'
down_revision: Union[str, None] = 'b4e1f2a9c7d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('schedule_baseline_activities', sa.Column('code', sa.String(length=20), nullable=True))
    op.execute(
        """
        UPDATE schedule_baseline_activities sba
        SET code = a.code
        FROM activities a
        WHERE a.id = sba.activity_id
        """
    )
    op.alter_column('schedule_baseline_activities', 'code', nullable=False)


def downgrade() -> None:
    op.drop_column('schedule_baseline_activities', 'code')
