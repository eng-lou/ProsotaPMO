"""Scheduling Phase 8: reassessment log support (last_reviewed_date)

Wires Activity into the shared polymorphic reassessments table (Risk/ICD/
Cost's pattern) — adds last_reviewed_date to match those three models'
field of the same name, so app/services/reassessment.py can auto-bump it
whenever a reassessment is logged against an activity.
See docs/SCHEDULING_MODULE_PLAN.md Phase 8.

Revision ID: 203c324947c5
Revises: d6d185855951
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa


revision = "203c324947c5"
down_revision = "d6d185855951"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("last_reviewed_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("activities", "last_reviewed_date")
