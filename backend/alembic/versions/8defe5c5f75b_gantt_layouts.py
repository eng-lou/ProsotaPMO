"""gantt layouts

Revision ID: 8defe5c5f75b
Revises: 52d17dc742df
Create Date: 2026-07-03 20:06:20.058443

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '8defe5c5f75b'
down_revision: Union[str, None] = '52d17dc742df'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Note: autogenerate also flagged several pre-existing unique constraints as
    # "removed" (models never declared them via __table_args__) — left alone,
    # out of scope for this migration (see 00a26a304901's own note).
    op.create_table('gantt_layouts',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('style', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('letterhead_snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('gantt_layouts')
