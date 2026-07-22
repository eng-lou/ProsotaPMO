"""add pivot rotation fields to element transforms

Revision ID: 9a2c4e7f1b3d
Revises: 71dcb26967b5
Create Date: 2026-07-22 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9a2c4e7f1b3d'
down_revision: Union[str, None] = '71dcb26967b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('element_transforms', sa.Column('pivot_rotation_x', sa.Float(), nullable=True))
    op.add_column('element_transforms', sa.Column('pivot_rotation_y', sa.Float(), nullable=True))
    op.add_column('element_transforms', sa.Column('pivot_rotation_z', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('element_transforms', 'pivot_rotation_z')
    op.drop_column('element_transforms', 'pivot_rotation_y')
    op.drop_column('element_transforms', 'pivot_rotation_x')
