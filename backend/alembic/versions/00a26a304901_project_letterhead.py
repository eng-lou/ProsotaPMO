"""project letterhead

Revision ID: 00a26a304901
Revises: ad2c1601e7c6
Create Date: 2026-07-03 19:20:38.644026

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '00a26a304901'
down_revision: Union[str, None] = 'ad2c1601e7c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Note: autogenerate also flagged several pre-existing unique constraints
    # (uq_risks_project_code etc.) as "removed" — that's the models never having
    # declared them via __table_args__, not a real schema change wanted here.
    # Left alone; out of scope for this migration.
    op.create_table('project_letterheads',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('logo_data_url', sa.Text(), nullable=True),
    sa.Column('logo_position', sa.String(length=10), nullable=False),
    sa.Column('header_zones', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('footer_zones', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id')
    )


def downgrade() -> None:
    op.drop_table('project_letterheads')
