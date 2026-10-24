"""Track access request email delivery independently from approval."""
from alembic import op
import sqlalchemy as sa

revision = "af57df178290"
down_revision = "fe46cf067189"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("access_notification_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("access_notification_attempted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("users", "access_notification_attempted_at")
    op.drop_column("users", "access_notification_sent_at")
