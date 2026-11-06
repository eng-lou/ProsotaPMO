"""IFC revision audit and BOQ area/review state."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = 'b179f139a4b2'
down_revision = 'b068e02893a1'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('model3d_files', sa.Column('ifc_revisions', postgresql.JSONB(), nullable=True))
    op.add_column('cost_rate_lines', sa.Column('area_m2', sa.Numeric(16, 3), nullable=True))
    op.add_column('cost_rate_lines', sa.Column('quantity_review_required', sa.Boolean(), nullable=False, server_default=sa.false()))

def downgrade():
    op.drop_column('cost_rate_lines', 'quantity_review_required')
    op.drop_column('cost_rate_lines', 'area_m2')
    op.drop_column('model3d_files', 'ifc_revisions')
