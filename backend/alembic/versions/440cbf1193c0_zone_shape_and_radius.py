"""zone shape and radius (circular clearance zones)

Revision ID: 440cbf1193c0
Revises: bb8df8497e0a
Create Date: 2026-07-30

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '440cbf1193c0'
down_revision = 'bb8df8497e0a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 2026-07-30, per Maro: "the radial zone for things like crane
    # clearance etc" — every existing row keeps its own points array and
    # renders exactly as before (shape='polygon' is the pre-existing
    # behaviour); radius only matters once shape='circle'.
    op.add_column('zones', sa.Column('shape', sa.String(10), nullable=False, server_default='polygon'))
    op.add_column('zones', sa.Column('radius', sa.Float(), nullable=False, server_default='5.0'))


def downgrade() -> None:
    op.drop_column('zones', 'radius')
    op.drop_column('zones', 'shape')
