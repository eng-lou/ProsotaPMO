"""annotation leader_visible

Revision ID: b010f75a810e
Revises: b74b2f570506
Create Date: 2026-07-30

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b010f75a810e'
down_revision = 'b74b2f570506'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('annotations', sa.Column('leader_visible', sa.Boolean(), nullable=False, server_default='true'))


def downgrade() -> None:
    op.drop_column('annotations', 'leader_visible')
