"""One-time desktop handoffs and revocable desktop sessions."""
from alembic import op
import sqlalchemy as sa

revision = "fc24ade45f67"
down_revision = "fb139cd34e56"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("desktop_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("challenge", sa.String(43), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_desktop_sessions_user_id", "desktop_sessions", ["user_id"])
    op.create_index("ix_desktop_sessions_expires_at", "desktop_sessions", ["expires_at"])


def downgrade():
    op.drop_table("desktop_sessions")
