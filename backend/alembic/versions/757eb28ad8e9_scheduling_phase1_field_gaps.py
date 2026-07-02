"""Scheduling Phase 1: field gaps + fix the computed-field bug on activities

Adds code/activity_type/duration_days/commentary/actual_start/actual_finish/
remaining_duration_days. total_float/is_critical stop being manual-entry
fields (same bug class as Risk's EMV and Cost's CPI/SPI) — is_critical
becomes nullable (null = "not yet computed by the CPM engine", Phase 5),
existing rows reset rather than keeping stale Sprint-1 test values.
See docs/SCHEDULING_MODULE_PLAN.md Phase 1.

Revision ID: 757eb28ad8e9
Revises: 17bb0f8d6027
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa


revision = "757eb28ad8e9"
down_revision = "17bb0f8d6027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("code", sa.String(length=20), nullable=True))
    op.add_column(
        "activities",
        sa.Column("activity_type", sa.String(length=20), nullable=False, server_default="task"),
    )
    op.add_column("activities", sa.Column("duration_days", sa.Integer(), nullable=True))
    op.add_column("activities", sa.Column("actual_start", sa.Date(), nullable=True))
    op.add_column("activities", sa.Column("actual_finish", sa.Date(), nullable=True))
    op.add_column("activities", sa.Column("remaining_duration_days", sa.Integer(), nullable=True))
    op.add_column("activities", sa.Column("commentary", sa.Text(), nullable=True))

    connection = op.get_bind()
    connection.execute(sa.text("""
        UPDATE activities a SET code = 'ACT-' || LPAD(sub.rn::text, 4, '0')
        FROM (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at) AS rn FROM activities) sub
        WHERE a.id = sub.id
    """))
    op.alter_column("activities", "code", nullable=False)
    op.create_unique_constraint("uq_activities_project_code", "activities", ["project_id", "code"])

    # total_float/is_critical were free manual-entry fields with no real CPM engine
    # behind them (Sprint-1 scaffold) — reset rather than carry forward stale values.
    connection.execute(sa.text("UPDATE activities SET total_float = NULL, is_critical = NULL"))
    op.alter_column("activities", "is_critical", nullable=True, server_default=None)


def downgrade() -> None:
    op.drop_constraint("uq_activities_project_code", "activities", type_="unique")
    op.alter_column("activities", "is_critical", nullable=False, server_default=sa.false())
    op.drop_column("activities", "commentary")
    op.drop_column("activities", "remaining_duration_days")
    op.drop_column("activities", "actual_finish")
    op.drop_column("activities", "actual_start")
    op.drop_column("activities", "duration_days")
    op.drop_column("activities", "activity_type")
    op.drop_column("activities", "code")
