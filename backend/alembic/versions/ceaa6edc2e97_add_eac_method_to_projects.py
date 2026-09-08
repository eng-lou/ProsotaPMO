"""add eac_method to projects

Revision ID: ceaa6edc2e97
Revises: e60518561de4
Create Date: 2026-09-08 07:33:01.036156

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'ceaa6edc2e97'
down_revision: Union[str, None] = 'e60518561de4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('eac_method', sa.String(length=20), server_default='cpi', nullable=False))


def downgrade() -> None:
    op.drop_column('projects', 'eac_method')
