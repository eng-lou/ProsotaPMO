"""Atomic, revision checked site authoring recipes."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = "fd35bef56078"
down_revision = "fc24ade45f67"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("site_scenes",
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("items", JSONB(), nullable=False, server_default="[]"))
    op.create_table("site_scene_commands",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False))
    op.create_index("ix_site_scene_commands_project_id", "site_scene_commands", ["project_id"])


def downgrade():
    op.drop_table("site_scene_commands")
    op.drop_table("site_scenes")
