"""scheduling quality criteria and saved runs

Revision ID: 90064aca680c
Revises: 8defe5c5f75b
Create Date: 2026-07-03 21:32:44.817533

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '90064aca680c'
down_revision: Union[str, None] = '8defe5c5f75b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Note: autogenerate also flagged several pre-existing unique constraints as
    # "removed" (models never declared them via __table_args__) — left alone,
    # out of scope for this migration (see 00a26a304901's own note).
    op.create_table('scheduling_quality_criteria',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('check_number', sa.Integer(), nullable=False),
    sa.Column('threshold', sa.Numeric(precision=5, scale=2), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'check_number', name='uq_scheduling_quality_criteria_project_check')
    )
    op.create_table('scheduling_quality_runs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('period_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('report', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['period_id'], ['periods.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('scheduling_quality_runs')
    op.drop_table('scheduling_quality_criteria')
