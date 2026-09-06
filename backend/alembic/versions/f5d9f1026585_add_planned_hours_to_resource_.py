"""add planned_hours to resource_assignments

Revision ID: f5d9f1026585
Revises: ea686aad762e
Create Date: 2026-09-06 17:59:50.769617

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f5d9f1026585'
down_revision: Union[str, None] = 'ea686aad762e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('resource_assignments', sa.Column('planned_hours', sa.Numeric(precision=14, scale=6), nullable=True))


def downgrade() -> None:
    op.drop_column('resource_assignments', 'planned_hours')
