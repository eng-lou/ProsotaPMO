"""Portable site asset versions, independent from scene placements."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = "fe46cf067189"
down_revision = "fd35bef56078"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("site_assets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("storage_key", sa.String(300), nullable=False, unique=True),
        sa.Column("upload_key", sa.String(300), nullable=False, unique=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("dimensions", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_site_assets_project_id", "site_assets", ["project_id"])


def downgrade():
    op.drop_table("site_assets")
