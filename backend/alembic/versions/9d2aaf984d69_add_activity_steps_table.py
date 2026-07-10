"""add activity_steps table

Revision ID: 9d2aaf984d69
Revises: e67d0ce27efb
Create Date: 2026-07-07 15:03:43.618938

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9d2aaf984d69'
down_revision: Union[str, None] = 'e67d0ce27efb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('activity_steps',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('activity_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('is_complete', sa.Boolean(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['activity_id'], ['activities.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('activity_steps')
