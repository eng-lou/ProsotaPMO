"""Media and icon callouts built on annotations."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ab12cd34ef56"
down_revision = "fe46cf067189"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("annotations", sa.Column("callout", postgresql.JSONB(), nullable=False, server_default="{}"))
    op.create_table("annotation_media",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("content_type", sa.String(30), nullable=False),
        sa.Column("ready", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_annotation_media_project_id", "annotation_media", ["project_id"])


def downgrade():
    op.drop_table("annotation_media")
    op.drop_column("annotations", "callout")
