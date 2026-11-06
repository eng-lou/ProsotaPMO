"""Persist visual tile isolation; stores planes, never tile content."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = 'c280a24b51c3'
down_revision = 'b179f139a4b2'
branch_labels = None
depends_on = None
def upgrade():
    op.add_column('site_contexts', sa.Column('cutout_mode', sa.String(12), nullable=False, server_default='remove'))
    op.add_column('site_contexts', sa.Column('view_isolation', JSONB(), nullable=True))
def downgrade():
    op.drop_column('site_contexts', 'view_isolation')
    op.drop_column('site_contexts', 'cutout_mode')
