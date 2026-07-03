"""Named, saved schedule baselines (create + assign, not one overwriteable slot)

Per Maro's P6-style correction: a planner should be able to capture many
named, dated baselines over a project's life and choose which one is
currently assigned for variance comparison, rather than one slot that gets
silently overwritten every time "Set Baseline" is clicked.

Adds schedule_baselines (period_id, name, baseline_date, is_active) and
schedule_baseline_activities (per-activity start/finish/duration_hours
snapshot, ON DELETE CASCADE on both FKs). is_active tracks which saved
baseline's snapshot last populated activities.bl_start/bl_finish/
bl_duration_hours — those columns are unchanged, still the single source
every other feature (variance, DCMA, CSV/print) reads.

is_active lives on schedule_baselines itself rather than a
periods.active_baseline_id FK back to this table — that shape is a genuine
circular FK between periods and schedule_baselines (this table already
points at periods via period_id), which breaks SQLAlchemy's table
create/drop ordering (confirmed via CircularDependencyError in tests) and
produced stale reads through the back-reference. Simpler and safe as an
application-level invariant (app/services/schedule_baseline.py:
assign_baseline is the only place that ever flips it, always clearing every
sibling in the same period first).

The old one-shot POST /activities/set-baseline action and its service
(app/services/scheduling_baseline.py) are retired — replaced by
POST /schedule-baselines/ (create/capture) and
POST /schedule-baselines/{id}/assign (apply). Existing activities' bl_start/
bl_finish are left untouched by this migration; they'll only change once a
new baseline is explicitly assigned.

Revision ID: ad2c1601e7c6
Revises: 38de5d3be984
Create Date: 2026-07-03

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "ad2c1601e7c6"
down_revision = "38de5d3be984"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "schedule_baselines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("period_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("periods.id"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("baseline_date", sa.Date(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "schedule_baseline_activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "baseline_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("schedule_baselines.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "activity_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("start", sa.DateTime(), nullable=True),
        sa.Column("finish", sa.DateTime(), nullable=True),
        sa.Column("duration_hours", sa.Numeric(7, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("schedule_baseline_activities")
    op.drop_table("schedule_baselines")
