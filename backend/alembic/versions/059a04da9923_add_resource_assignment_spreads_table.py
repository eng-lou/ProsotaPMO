"""add resource_assignment_spreads table

Revision ID: 059a04da9923
Revises: bb11af82cf43
Create Date: 2026-07-07 16:39:54.345499

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '059a04da9923'
down_revision: Union[str, None] = 'bb11af82cf43'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('resource_assignment_spreads',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('resource_assignment_id', sa.UUID(), nullable=False),
    sa.Column('work_date', sa.Date(), nullable=False),
    sa.Column('hours', sa.Numeric(precision=6, scale=2), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['resource_assignment_id'], ['resource_assignments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('resource_assignment_id', 'work_date', name='uq_resource_assignment_spreads_assignment_date')
    )


def downgrade() -> None:
    op.drop_table('resource_assignment_spreads')
