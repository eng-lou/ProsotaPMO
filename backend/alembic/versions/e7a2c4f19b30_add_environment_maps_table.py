"""add environment_maps table

Revision ID: e7a2c4f19b30
Revises: ceaa6edc2e97
Create Date: 2026-09-30 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e7a2c4f19b30'
down_revision: Union[str, None] = 'ceaa6edc2e97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# A project's saved custom HDR/EXR environment (2026-09-30) — see
# app/models/environment_map.py. One per project.
def upgrade() -> None:
    op.create_table('environment_maps',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=500), nullable=False),
    sa.Column('storage_filename', sa.String(length=500), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id')
    )


def downgrade() -> None:
    op.drop_table('environment_maps')
