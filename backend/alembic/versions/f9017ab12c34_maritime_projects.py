"""Persistent Maritime projects and versioned runs.

Revision ID: f9017ab12c34
Revises: e8c395fd0123
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'f9017ab12c34'
down_revision = 'e8c395fd0123'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('projects', sa.Column('workspace', sa.String(20), nullable=False, server_default='construction'))
    op.create_check_constraint('ck_project_workspace', 'projects', "workspace IN ('construction', 'maritime')")
    op.create_table('maritime_workspaces',
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('version', sa.Integer(), nullable=False), sa.Column('definition', postgresql.JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_table('maritime_runs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False), sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('inputs', postgresql.JSONB(), nullable=False), sa.Column('results', postgresql.JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_maritime_runs_project_id', 'maritime_runs', ['project_id'])


def downgrade():
    op.drop_table('maritime_runs')
    op.drop_table('maritime_workspaces')
    op.drop_constraint('ck_project_workspace', 'projects', type_='check')
    op.drop_column('projects', 'workspace')
