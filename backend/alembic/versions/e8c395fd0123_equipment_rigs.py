"""Reusable rigid equipment controls and keyframes."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'e8c395fd0123'
down_revision = 'd7b284ec9012'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('equipment_rigs',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('project_id', sa.UUID(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('model_ref', sa.String(300), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('definition', postgresql.JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('project_id', 'model_ref', name='uq_equipment_model'))
    op.create_index('ix_equipment_rigs_project_id', 'equipment_rigs', ['project_id'])


def downgrade():
    op.drop_table('equipment_rigs')
