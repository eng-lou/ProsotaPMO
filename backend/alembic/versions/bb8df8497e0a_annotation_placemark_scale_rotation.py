"""annotation placemark scale/rotation

Revision ID: bb8df8497e0a
Revises: 885025fad5a1
Create Date: 2026-07-30

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'bb8df8497e0a'
down_revision = '885025fad5a1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('annotations', sa.Column('placemark_scale', sa.Float(), nullable=False, server_default='1.0'))
    op.add_column('annotations', sa.Column('placemark_rotation', sa.Float(), nullable=False, server_default='0.0'))


def downgrade() -> None:
    op.drop_column('annotations', 'placemark_rotation')
    op.drop_column('annotations', 'placemark_scale')
