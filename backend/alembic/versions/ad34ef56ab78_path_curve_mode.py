"""Persist straight or curved path interpolation."""
from alembic import op
import sqlalchemy as sa
revision = 'ad34ef56ab78'
down_revision = 'ac23de45fa67'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('paths', sa.Column('curve_mode', sa.String(10), nullable=False, server_default='curved'))

def downgrade():
    op.drop_column('paths', 'curve_mode')
