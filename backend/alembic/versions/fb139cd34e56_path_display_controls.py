"""Persist path opacity and independent viewport/render display controls."""
from alembic import op
import sqlalchemy as sa

revision = "fb139cd34e56"
down_revision = "fa028bc23d45"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("paths", sa.Column("opacity", sa.Float(), nullable=False, server_default="1"))
    op.add_column("paths", sa.Column("show_in_viewport", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("paths", sa.Column("show_in_render", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade():
    for name in ("show_in_render", "show_in_viewport", "opacity"):
        op.drop_column("paths", name)
