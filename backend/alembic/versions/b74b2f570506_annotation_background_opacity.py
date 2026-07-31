"""annotation background opacity

Revision ID: b74b2f570506
Revises: 440cbf1193c0
Create Date: 2026-07-30

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b74b2f570506'
down_revision = '440cbf1193c0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('annotations', sa.Column('background_opacity', sa.Float(), nullable=False, server_default='1.0'))


def downgrade() -> None:
    op.drop_column('annotations', 'background_opacity')
