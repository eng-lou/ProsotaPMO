"""Resources Phase 2: cost element source/linked_activity_id

Adds source ("manual" | "schedule") and linked_activity_id to cost_elements, so
an activity's resource assignments can auto-manage a linked cost line (one-way
sync, Scheduling -> Cost Plan) — see app/services/cost_sync.py and
docs/RESOURCES_MODULE_PLAN.md.

Revision ID: 6369d28b1505
Revises: 079fa3ffcd40
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "6369d28b1505"
down_revision = "079fa3ffcd40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cost_elements", sa.Column("source", sa.String(length=20), nullable=False, server_default="manual"))
    op.add_column(
        "cost_elements",
        sa.Column(
            "linked_activity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_unique_constraint("uq_cost_elements_linked_activity_id", "cost_elements", ["linked_activity_id"])


def downgrade() -> None:
    op.drop_constraint("uq_cost_elements_linked_activity_id", "cost_elements", type_="unique")
    op.drop_column("cost_elements", "linked_activity_id")
    op.drop_column("cost_elements", "source")
