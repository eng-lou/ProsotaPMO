"""add fourd_videos table

Revision ID: 1114d35e2759
Revises: 0781dab0dadc
Create Date: 2026-07-20 20:07:26.279015

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '1114d35e2759'
down_revision: Union[str, None] = '0781dab0dadc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('fourd_videos',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=300), nullable=False),
    sa.Column('storage_filename', sa.String(length=300), nullable=False),
    sa.Column('duration_sec', sa.Float(), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('storage_filename')
    )


def downgrade() -> None:
    op.drop_table('fourd_videos')
