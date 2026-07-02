"""Scheduling Phase 5: CPM engine (forward/backward pass)

Adds free_float. start/finish/total_float/free_float/is_critical are all
now computed by app/services/scheduling_cpm.py's forward/backward pass —
no DB change needed for that (start/finish already existed as columns,
this just changes what's accepted as API input at the schema level).
See docs/SCHEDULING_MODULE_PLAN.md Phase 5.

Revision ID: 8c9d1742eb2a
Revises: c6c0d4737726
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa


revision = "8c9d1742eb2a"
down_revision = "c6c0d4737726"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("free_float", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("activities", "free_float")
