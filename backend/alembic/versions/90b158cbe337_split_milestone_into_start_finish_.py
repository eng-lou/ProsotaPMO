"""split milestone into start_milestone/finish_milestone

Revision ID: 90b158cbe337
Revises: fca681f2e030
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = '90b158cbe337'
down_revision: Union[str, None] = 'fca681f2e030'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # activity_type is a plain VARCHAR(20), not a Postgres enum — a data-only
    # migration. Existing "milestone" rows default to "finish_milestone" (the
    # more common convention: most milestones mark completion of something),
    # per Maro's own confirmed default — flagged in
    # docs/SCHEDULING_GAPS_PLAN.md for correction if any specific project's
    # existing milestones actually meant "start" instead.
    op.execute("UPDATE activities SET activity_type = 'finish_milestone' WHERE activity_type = 'milestone'")


def downgrade() -> None:
    op.execute("UPDATE activities SET activity_type = 'milestone' WHERE activity_type IN ('start_milestone', 'finish_milestone')")
