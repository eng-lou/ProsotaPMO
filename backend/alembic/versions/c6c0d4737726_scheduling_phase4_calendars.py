"""Scheduling Phase 4: calendars (multi-calendar, project default + per-activity override)

Adds calendars (working-day pattern + hours/day, one is_project_default per
project) and calendar_exceptions (working-day overrides, both directions).
activities.calendar_id is nullable — null means "inherit the project's
default calendar" — ON DELETE SET NULL so deleting a custom calendar
reverts activities using it rather than blocking the delete.
See docs/SCHEDULING_MODULE_PLAN.md Phase 4.

Revision ID: c6c0d4737726
Revises: f426a53c63b3
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "c6c0d4737726"
down_revision = "f426a53c63b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calendars",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("is_project_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("hours_per_day", sa.Numeric(4, 2), nullable=False, server_default="8"),
        sa.Column("works_monday", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("works_tuesday", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("works_wednesday", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("works_thursday", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("works_friday", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("works_saturday", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("works_sunday", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "calendar_exceptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "calendar_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("calendars.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("is_working", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column(
        "activities",
        sa.Column(
            "calendar_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("calendars.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("activities", "calendar_id")
    op.drop_table("calendar_exceptions")
    op.drop_table("calendars")
