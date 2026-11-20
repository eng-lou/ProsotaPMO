"""Persist manual realistic finishes with their project."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = 'f513d57e84f6'
down_revision = 'e402c46d73e5'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('projects', sa.Column('material_mapping', JSONB(), nullable=True))

def downgrade():
    op.drop_column('projects', 'material_mapping')
