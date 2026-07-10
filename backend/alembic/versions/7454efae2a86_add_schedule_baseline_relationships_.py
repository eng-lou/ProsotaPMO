"""add schedule_baseline_relationships table

Revision ID: 7454efae2a86
Revises: 90b158cbe337
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '7454efae2a86'
down_revision: Union[str, None] = '90b158cbe337'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('schedule_baseline_relationships',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('baseline_id', sa.UUID(), nullable=False),
    sa.Column('predecessor_id', sa.UUID(), nullable=False),
    sa.Column('successor_id', sa.UUID(), nullable=False),
    sa.Column('relationship_type', sa.String(length=2), nullable=False),
    sa.Column('lag_hours', sa.Numeric(precision=6, scale=2), nullable=False),
    sa.ForeignKeyConstraint(['baseline_id'], ['schedule_baselines.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['predecessor_id'], ['activities.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['successor_id'], ['activities.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('schedule_baseline_relationships')
