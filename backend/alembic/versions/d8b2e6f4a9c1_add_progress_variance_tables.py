"""add progress variance tests and results tables

Revision ID: d8b2e6f4a9c1
Revises: c3f7a9e2b1d4
Create Date: 2026-08-20 10:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd8b2e6f4a9c1'
down_revision: Union[str, None] = 'c3f7a9e2b1d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('progress_variance_tests',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('group_a_collection_id', sa.UUID(), nullable=False),
    sa.Column('site_capture_id', sa.UUID(), nullable=False),
    sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['group_a_collection_id'], ['collections.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['site_capture_id'], ['site_captures.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_progress_variance_tests_project_id'), 'progress_variance_tests', ['project_id'], unique=False)
    op.create_index(op.f('ix_progress_variance_tests_group_a_collection_id'), 'progress_variance_tests', ['group_a_collection_id'], unique=False)
    op.create_index(op.f('ix_progress_variance_tests_site_capture_id'), 'progress_variance_tests', ['site_capture_id'], unique=False)

    op.create_table('progress_variance_results',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('progress_variance_test_id', sa.UUID(), nullable=False),
    sa.Column('element_source_kind', sa.String(length=10), nullable=False),
    sa.Column('element_ref', sa.String(length=300), nullable=False),
    sa.Column('element_label', sa.String(length=300), nullable=False),
    sa.Column('point_count', sa.Integer(), nullable=False),
    sa.Column('confirmed_in_scan', sa.Boolean(), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('comment', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['progress_variance_test_id'], ['progress_variance_tests.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('progress_variance_test_id', 'element_ref', name='uq_progress_variance_results_element')
    )
    op.create_index(op.f('ix_progress_variance_results_progress_variance_test_id'), 'progress_variance_results', ['progress_variance_test_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_progress_variance_results_progress_variance_test_id'), table_name='progress_variance_results')
    op.drop_table('progress_variance_results')
    op.drop_index(op.f('ix_progress_variance_tests_site_capture_id'), table_name='progress_variance_tests')
    op.drop_index(op.f('ix_progress_variance_tests_group_a_collection_id'), table_name='progress_variance_tests')
    op.drop_index(op.f('ix_progress_variance_tests_project_id'), table_name='progress_variance_tests')
    op.drop_table('progress_variance_tests')
