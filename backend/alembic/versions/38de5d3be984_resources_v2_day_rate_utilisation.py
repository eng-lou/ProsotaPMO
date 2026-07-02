"""Resources v2: day-rate/utilisation costing

Adds resources.max_hours_per_day (a resource's normal daily capacity in hours,
default 8 — informational/capacity context, not itself a cost multiplier).
resource_assignments.quantity becomes nullable (only material resources use it
now) and gains utilisation_pct (0-100, only labour/equipment use it) — per Maro's
confirmed spec: labour/equipment are costed as day rate x utilisation% x the
activity's own duration in days, so cost follows the schedule automatically;
material keeps the original Qty x Rate build-up; subcontractor stays a flat lump
sum regardless of duration/utilisation. See app/models/resource_assignment.py and
app/services/resource_costing.py.

Existing rows: quantity is left as-is (still meaningful for any existing material
assignments); labour/equipment/subcontractor rows get no utilisation_pct backfill
(defaults to 100% in the costing formula, i.e. unchanged full-day/full-lump-sum
behaviour) — no data is lost, but existing labour/equipment assignment budgets
will change on next read from "manually-typed quantity x rate" to
"activity-duration x 100% x rate", since that manual quantity concept no longer
applies to those types. A one-time, deliberate behaviour change, not a bug.

Revision ID: 38de5d3be984
Revises: 6369d28b1505
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa


revision = "38de5d3be984"
down_revision = "6369d28b1505"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resources", sa.Column("max_hours_per_day", sa.Numeric(4, 2), nullable=False, server_default="8"))
    op.alter_column("resource_assignments", "quantity", existing_type=sa.Numeric(12, 2), nullable=True)
    op.add_column("resource_assignments", sa.Column("utilisation_pct", sa.Numeric(5, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("resource_assignments", "utilisation_pct")
    op.execute("UPDATE resource_assignments SET quantity = 1 WHERE quantity IS NULL")
    op.alter_column("resource_assignments", "quantity", existing_type=sa.Numeric(12, 2), nullable=False)
    op.drop_column("resources", "max_hours_per_day")
