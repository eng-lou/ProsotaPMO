"""Scheduling Phase 2: WBS hierarchy (MS Project style, self-referencing parent_id)

Adds parent_id (self-FK, ON DELETE CASCADE — deleting a summary task deletes its
subtree) and sort_order (sibling ordering, server-managed). wbs_path stops being
a manually-typed field — it's now derived from outline position by
app/services/activity.py:_recompute_hierarchy. Existing rows have no parent
(all root-level, wbs_path recomputed to "1", "2", "3"... on first write).
See docs/SCHEDULING_MODULE_PLAN.md Phase 2.

Revision ID: e20195ad92b4
Revises: 757eb28ad8e9
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "e20195ad92b4"
down_revision = "757eb28ad8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("activities.id", ondelete="CASCADE"), nullable=True),
    )
    op.add_column("activities", sa.Column("sort_order", sa.Integer(), nullable=True))

    # Backfill sort_order in creation order per (project, period) so existing rows get
    # a stable outline position; wbs_path itself is recomputed on the next write via
    # _recompute_hierarchy rather than backfilled here.
    connection = op.get_bind()
    connection.execute(sa.text("""
        UPDATE activities a SET sort_order = sub.rn
        FROM (
            SELECT id, row_number() OVER (PARTITION BY project_id, period_id ORDER BY created_at) AS rn
            FROM activities
        ) sub
        WHERE a.id = sub.id
    """))


def downgrade() -> None:
    op.drop_column("activities", "sort_order")
    op.drop_column("activities", "parent_id")
