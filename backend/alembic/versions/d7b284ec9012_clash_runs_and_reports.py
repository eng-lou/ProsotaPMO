"""Clash run history and scoped sharing.

Revision ID: d7b284ec9012
Revises: c6a1f823d904
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d7b284ec9012"
down_revision = "c6a1f823d904"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("clash_results", sa.Column("element_metadata", postgresql.JSONB(), server_default="{}", nullable=False))
    op.add_column("clash_results", sa.Column("clash_point", postgresql.JSONB(), nullable=True))
    op.drop_constraint("uq_clash_results_test_pair", "clash_results", type_="unique")
    op.create_unique_constraint("uq_clash_results_test_pair", "clash_results", ["clash_test_id", "element_a_source_kind", "element_a_ref", "element_b_source_kind", "element_b_ref"])
    op.add_column("clash_results", sa.Column("review_history", postgresql.JSONB(), server_default="[]", nullable=False))
    op.add_column("clash_results", sa.Column("issue_id", sa.UUID(), sa.ForeignKey("icd_items.id", ondelete="SET NULL"), nullable=True))
    for name in ("clash_runs", "clash_reports"):
        columns = [
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("clash_test_id", sa.UUID(), sa.ForeignKey("clash_tests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("snapshot", postgresql.JSONB(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        ]
        if name == "clash_reports":
            columns += [
                sa.Column("token_hash", sa.String(64), unique=True, nullable=False),
                sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
                sa.Column("revoked", sa.Boolean(), server_default=sa.false(), nullable=False),
                sa.Column("allow_comments", sa.Boolean(), server_default=sa.false(), nullable=False),
                sa.Column("comments", postgresql.JSONB(), server_default="[]", nullable=False),
            ]
        op.create_table(name, *columns)
        op.create_index(f"ix_{name}_clash_test_id", name, ["clash_test_id"])


def downgrade():
    op.drop_column("clash_results", "element_metadata")
    op.drop_column("clash_results", "clash_point")
    op.drop_column("clash_results", "review_history")
    op.drop_constraint("uq_clash_results_test_pair", "clash_results", type_="unique")
    op.create_unique_constraint("uq_clash_results_test_pair", "clash_results", ["clash_test_id", "element_a_ref", "element_b_ref"])
    op.drop_column("clash_results", "issue_id")
    op.drop_table("clash_reports")
    op.drop_table("clash_runs")
