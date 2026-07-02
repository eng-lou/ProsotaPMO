"""Scheduling Phase 6: baseline capture ("Set Baseline" action)

Adds bl_duration_days alongside the existing bl_start/bl_finish. All three
are set only by the new "Set Baseline" action
(app/services/scheduling_baseline.py) — a deliberate, repeatable snapshot
of current start/finish/duration_days, not the one-shot-at-creation freeze
Cost Plan's rev_a_baseline uses. See docs/SCHEDULING_MODULE_PLAN.md Phase 6.

Revision ID: d6d185855951
Revises: 8c9d1742eb2a
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa


revision = "d6d185855951"
down_revision = "8c9d1742eb2a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("bl_duration_days", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("activities", "bl_duration_days")
