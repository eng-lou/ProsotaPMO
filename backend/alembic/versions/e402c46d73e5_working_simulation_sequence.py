"""Promoted operational playback is separate from programme acceptance."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = 'e402c46d73e5'
down_revision = 'd391b35c62d4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('working_simulation_sequences',
        sa.Column('schedule_period_id', UUID(as_uuid=True), sa.ForeignKey('schedule_periods.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('project_id', UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('snapshot', JSONB(), nullable=False),
        sa.Column('source_hash', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index('ix_working_simulation_sequences_project_id', 'working_simulation_sequences', ['project_id'])


def downgrade():
    op.drop_table('working_simulation_sequences')
