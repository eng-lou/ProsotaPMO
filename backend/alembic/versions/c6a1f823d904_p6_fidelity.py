"""Preserve P6 source financial fields and baseline budgets."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = "c6a1f823d904"
down_revision = "b4d9e1a7c352"
branch_labels = None
depends_on = None

def upgrade():
    op.alter_column("cost_elements", "bl_budget", existing_type=sa.Numeric(14, 2), type_=sa.Numeric(24, 8))
    op.alter_column("cost_baseline_items", "bac", existing_type=sa.Numeric(14, 2), type_=sa.Numeric(24, 8))
    op.add_column("schedule_baselines", sa.Column("p6_data", postgresql.JSONB(), nullable=True))
    op.add_column("activities", sa.Column("p6_data", postgresql.JSONB(), nullable=True))
    op.add_column("resource_assignments", sa.Column("p6_data", postgresql.JSONB(), nullable=True))
    op.add_column("schedule_baseline_activities", sa.Column("budget", sa.Numeric(24, 8), nullable=True))

def downgrade():
    op.alter_column("cost_elements", "bl_budget", existing_type=sa.Numeric(24, 8), type_=sa.Numeric(14, 2))
    op.alter_column("cost_baseline_items", "bac", existing_type=sa.Numeric(24, 8), type_=sa.Numeric(14, 2))
    op.drop_column("schedule_baselines", "p6_data")
    op.drop_column("schedule_baseline_activities", "budget")
    op.drop_column("resource_assignments", "p6_data")
    op.drop_column("activities", "p6_data")
