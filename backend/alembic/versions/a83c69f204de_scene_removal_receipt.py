"""Record the prior scene fingerprint for undoing a removal."""
from alembic import op
import sqlalchemy as sa

revision = "a83c69f204de"
down_revision = "f513d57e84f6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("site_scene_commands", sa.Column("before_removal_hash", sa.String(64), nullable=True))


def downgrade():
    op.drop_column("site_scene_commands", "before_removal_hash")
