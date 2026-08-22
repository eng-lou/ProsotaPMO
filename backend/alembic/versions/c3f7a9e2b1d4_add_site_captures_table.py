"""add site_captures table

Revision ID: c3f7a9e2b1d4
Revises: a1c9f3e8b7d2
Create Date: 2026-08-20 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3f7a9e2b1d4'
down_revision: Union[str, None] = 'a1c9f3e8b7d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('site_captures',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=300), nullable=False),
    sa.Column('captured_at', sa.Date(), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('source_up_axis', sa.String(length=1), nullable=False),
    sa.Column('storage_filename', sa.String(length=300), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('force_visible', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('storage_filename')
    )
    op.create_index(op.f('ix_site_captures_project_id'), 'site_captures', ['project_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_site_captures_project_id'), table_name='site_captures')
    op.drop_table('site_captures')
