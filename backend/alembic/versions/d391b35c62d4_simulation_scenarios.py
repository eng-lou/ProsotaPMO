"""Operational activity steps and isolated simulation scenarios."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
revision = 'd391b35c62d4'
down_revision = 'c280a24b51c3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('activity_steps', sa.Column('operation', JSONB(), nullable=True))
    op.create_table('simulation_scenarios',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('project_id', UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('schedule_period_id', UUID(as_uuid=True), sa.ForeignKey('schedule_periods.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('config', JSONB(), nullable=False),
        sa.Column('source_hash', sa.String(64)), sa.Column('source', JSONB()), sa.Column('result', JSONB()),
        sa.Column('decisions', JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index('ix_simulation_scenarios_project_id', 'simulation_scenarios', ['project_id'])
    op.create_index('ix_simulation_scenarios_schedule_period_id', 'simulation_scenarios', ['schedule_period_id'])


def downgrade():
    op.drop_table('simulation_scenarios')
    op.drop_column('activity_steps', 'operation')
