"""add role to resources

Revision ID: 5229a23537bd
Revises: 059a04da9923
Create Date: 2026-07-07 17:49:30.203827

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5229a23537bd'
down_revision: Union[str, None] = '059a04da9923'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('resources', sa.Column('role', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('resources', 'role')
