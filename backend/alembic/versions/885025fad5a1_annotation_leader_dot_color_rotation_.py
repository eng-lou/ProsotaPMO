"""annotation leader dot radius, colour, rotation, scale

Revision ID: 885025fad5a1
Revises: 64d09fc5e119
Create Date: 2026-07-30

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '885025fad5a1'
down_revision = '64d09fc5e119'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('annotations', sa.Column('leader_dot_radius', sa.Float(), nullable=False, server_default='0.06'))
    op.add_column('annotations', sa.Column('leader_color', sa.String(9), nullable=False, server_default='#ffffff'))
    op.add_column('annotations', sa.Column('leader_rotation', sa.Float(), nullable=False, server_default='0.0'))
    op.add_column('annotations', sa.Column('leader_scale', sa.Float(), nullable=False, server_default='1.0'))
    # leader_color used to just be border_color reused for the line — copy
    # forward so no existing row's rendered look changes (2026-07-30).
    op.execute("UPDATE annotations SET leader_color = border_color")


def downgrade() -> None:
    op.drop_column('annotations', 'leader_scale')
    op.drop_column('annotations', 'leader_rotation')
    op.drop_column('annotations', 'leader_color')
    op.drop_column('annotations', 'leader_dot_radius')
