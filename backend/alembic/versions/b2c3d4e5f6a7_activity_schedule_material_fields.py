"""activity schedule material fields

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activities', sa.Column('schedule_material_name', sa.String(length=200), nullable=True))
    op.add_column('activities', sa.Column('schedule_material_quantity', sa.Numeric(precision=14, scale=2), nullable=True))
    op.add_column('activities', sa.Column('schedule_material_unit', sa.String(length=20), nullable=True))
    op.add_column('activities', sa.Column('schedule_material_cost_per_unit', sa.Numeric(precision=14, scale=2), nullable=True))


def downgrade() -> None:
    op.drop_column('activities', 'schedule_material_cost_per_unit')
    op.drop_column('activities', 'schedule_material_unit')
    op.drop_column('activities', 'schedule_material_quantity')
    op.drop_column('activities', 'schedule_material_name')
