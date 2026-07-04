"""merge_duplicate_live_periods

Revision ID: a3f9c02e5b71
Revises: 7f7cfcfa8eaf
Create Date: 2026-07-04 09:00:00.000000

The "auto-create Period 1 if none exists" stopgap (frontend
useActivePeriod, pending the real Period Manager) has no protection
against two concurrent bootstrap calls both seeing zero periods and
both creating one — found via a real project where two "Period 1"
rows exist ~1.5ms apart, silently splitting that project's
activities/risks/cost/ICD data across two "live" periods. Which one
the app treats as active isn't guaranteed to be stable (periods were
being read with no ORDER BY), so an action like Reschedule could
appear to do nothing depending on which period happened to be picked
that time.

This migration folds any project's extra "live" periods into its
oldest one (reassigning every period-scoped row), then adds a partial
unique index so it can't happen again — a project may have many
periods over its life (frozen, incorporated, ...) but only one can
ever be "live" at a time, which matches the real Period Manager
state machine this is a stopgap for (ARCHITECTURE.md §3).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3f9c02e5b71'
down_revision: Union[str, None] = '7f7cfcfa8eaf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PERIOD_SCOPED_TABLES = (
    "activities",
    "risks",
    "cost_elements",
    "icd_items",
    "schedule_baselines",
    "scheduling_quality_runs",
)


def upgrade() -> None:
    op.execute(
        """
        CREATE TEMP TABLE _period_dupe_map AS
        WITH ranked AS (
            SELECT id, project_id,
                   ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
            FROM periods
            WHERE freeze_status = 'live'
        ),
        canonical AS (
            SELECT project_id, id AS canonical_id FROM ranked WHERE rn = 1
        )
        SELECT r.id AS dupe_id, c.canonical_id
        FROM ranked r
        JOIN canonical c USING (project_id)
        WHERE r.rn > 1
        """
    )

    for table in _PERIOD_SCOPED_TABLES:
        op.execute(
            f"""
            UPDATE {table} t
            SET period_id = m.canonical_id
            FROM _period_dupe_map m
            WHERE t.period_id = m.dupe_id
            """
        )

    op.execute(
        """
        DELETE FROM periods p
        USING _period_dupe_map m
        WHERE p.id = m.dupe_id
        """
    )

    op.execute("DROP TABLE _period_dupe_map")

    op.create_index(
        "uq_periods_project_live",
        "periods",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("freeze_status = 'live'"),
    )


def downgrade() -> None:
    # Only removes the constraint — the duplicate period rows merged/deleted
    # in upgrade() are not reconstructable, matching this repo's convention
    # of not resurrecting deleted data on downgrade.
    op.drop_index("uq_periods_project_live", table_name="periods")
