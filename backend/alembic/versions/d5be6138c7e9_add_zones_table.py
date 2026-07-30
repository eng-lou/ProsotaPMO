"""add zones table

Revision ID: d5be6138c7e9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd5be6138c7e9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('zones',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=300), nullable=False),
    sa.Column('points', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('elevation', sa.Float(), nullable=False),
    sa.Column('fill_color', sa.String(length=9), nullable=False),
    sa.Column('fill_opacity', sa.Float(), nullable=False),
    sa.Column('border_color', sa.String(length=9), nullable=False),
    sa.Column('visible', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    )
    # No explicit create_index for project_id here — matches every sibling
    # migration in this file's own family (paths/path_followers, annotations)
    # despite each model declaring index=True; a pre-existing drift across
    # this codebase's migrations, not something this one migration should
    # fix in isolation.


def downgrade() -> None:
    op.drop_table('zones')
