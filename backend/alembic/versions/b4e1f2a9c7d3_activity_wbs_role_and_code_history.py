"""activity_wbs_role_and_code_history

Revision ID: b4e1f2a9c7d3
Revises: a3f9c02e5b71
Create Date: 2026-07-04 10:00:00.000000

Replaces the generic ACT-0001 activity code scheme with a role-based one
(2026-07-04, per Maro): P for a top-level WBS summary, W for a nested WBS
summary, T for a plain task, M for a milestone — each with its own
independent numbering sequence per project, auto-updated whenever an
activity's role changes (indent/outdent promoting/demoting it).

`wbs_role` tracks that structural role explicitly (not parsed from `code`,
which is also manually editable) so a user's own rename never gets mistaken
for a real hierarchy-driven change. `activity_code_history` is the
append-only audit trail of every code change (old->new, reason, when).

This is pre-production data (no real customer schedules exist yet), so
every existing activity's code is renumbered onto the new scheme as part of
this migration, grouped by project+role and ordered by creation time —
not preserved as a mixed ACT-/new-scheme set.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4e1f2a9c7d3'
down_revision: Union[str, None] = 'a3f9c02e5b71'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activities', sa.Column('wbs_role', sa.String(length=1), nullable=False, server_default='T'))

    op.create_table(
        'activity_code_history',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('activity_id', sa.UUID(), nullable=False),
        sa.Column('old_code', sa.String(length=20), nullable=True),
        sa.Column('new_code', sa.String(length=20), nullable=False),
        sa.Column('reason', sa.String(length=30), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['activity_id'], ['activities.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # Backfill wbs_role from each activity's current activity_type + parent_id.
    op.execute(
        """
        UPDATE activities
        SET wbs_role = CASE
            WHEN activity_type = 'milestone' THEN 'M'
            WHEN activity_type = 'wbs_summary' AND parent_id IS NULL THEN 'P'
            WHEN activity_type = 'wbs_summary' THEN 'W'
            ELSE 'T'
        END
        """
    )

    # Renumber every existing code onto the new scheme: one independent sequence
    # per (project, role), ordered by creation time. No activity_code_history rows
    # are logged for this one-time migration event — that log starts tracking
    # real promote/demote/manual-edit changes from here on, not this bulk reset.
    op.execute(
        """
        WITH roled AS (
            SELECT id, project_id, wbs_role,
                   ROW_NUMBER() OVER (PARTITION BY project_id, wbs_role ORDER BY created_at, id) AS rn
            FROM activities
        )
        UPDATE activities a
        SET code = r.wbs_role || '-' || LPAD(r.rn::text, 4, '0')
        FROM roled r
        WHERE a.id = r.id
        """
    )


def downgrade() -> None:
    # Renumbering codes back to the old ACT-0001 scheme isn't reconstructable
    # (the original per-project ACT sequence is gone) — downgrade only removes
    # the new structures, matching this repo's convention of not resurrecting
    # transformed data on downgrade.
    op.drop_table('activity_code_history')
    op.drop_column('activities', 'wbs_role')
