"""Persist reversible edits alongside the site scene."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "b81ad9e056c2"
down_revision = "a83c69f204de"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("site_scenes", sa.Column("history", JSONB(), nullable=True))


def downgrade():
    op.drop_column("site_scenes", "history")
