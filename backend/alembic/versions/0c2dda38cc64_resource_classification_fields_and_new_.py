"""resource classification fields and new types

Revision ID: 0c2dda38cc64
Revises: 5229a23537bd
Create Date: 2026-07-08 00:14:17.301999

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0c2dda38cc64'
down_revision: Union[str, None] = '5229a23537bd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('resources', sa.Column('discipline', sa.String(length=255), nullable=True))
    op.add_column('resources', sa.Column('company', sa.String(length=255), nullable=True))
    op.add_column('resources', sa.Column('skill_level', sa.String(length=100), nullable=True))
    op.add_column('resources', sa.Column('category', sa.String(length=100), nullable=True))
    op.add_column('resources', sa.Column('cost_type', sa.String(length=20), nullable=True))
    op.add_column('resources', sa.Column('members', sa.String(length=1000), nullable=True))


def downgrade() -> None:
    op.drop_column('resources', 'members')
    op.drop_column('resources', 'cost_type')
    op.drop_column('resources', 'category')
    op.drop_column('resources', 'skill_level')
    op.drop_column('resources', 'company')
    op.drop_column('resources', 'discipline')
