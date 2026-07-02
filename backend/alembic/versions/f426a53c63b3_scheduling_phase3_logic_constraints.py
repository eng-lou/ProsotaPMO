"""Scheduling Phase 3: logic (predecessor/successor relationships) + constraints

Adds activity_relationships (predecessor_id/successor_id/relationship_type
FS-SS-FF-SF/lag_days, ON DELETE CASCADE on both FKs so deleting an activity
also removes any links referencing it) and constraint_type/constraint_date
on activities. See docs/SCHEDULING_MODULE_PLAN.md Phase 3.

Revision ID: f426a53c63b3
Revises: e20195ad92b4
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "f426a53c63b3"
down_revision = "e20195ad92b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("constraint_type", sa.String(length=10), nullable=True))
    op.add_column("activities", sa.Column("constraint_date", sa.Date(), nullable=True))

    op.create_table(
        "activity_relationships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "predecessor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "successor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("relationship_type", sa.String(length=2), nullable=False, server_default="FS"),
        sa.Column("lag_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("predecessor_id", "successor_id", name="uq_activity_relationship_pair"),
    )


def downgrade() -> None:
    op.drop_table("activity_relationships")
    op.drop_column("activities", "constraint_date")
    op.drop_column("activities", "constraint_type")
