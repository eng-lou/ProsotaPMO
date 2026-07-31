"""add radial charts table

Revision ID: e7f4a1c9b352
Revises: b010f75a810e
Create Date: 2026-07-31

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e7f4a1c9b352'
down_revision = 'b010f75a810e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('radial_charts',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('visible', sa.Boolean(), nullable=False),
    sa.Column('position_x_pct', sa.Float(), nullable=False),
    sa.Column('position_y_pct', sa.Float(), nullable=False),
    sa.Column('radius_px', sa.Float(), nullable=False),
    sa.Column('thickness_px', sa.Float(), nullable=False),
    sa.Column('border_color', sa.String(length=9), nullable=False),
    sa.Column('track_color', sa.String(length=9), nullable=False),
    sa.Column('progress_color', sa.String(length=9), nullable=False),
    sa.Column('fill_color', sa.String(length=9), nullable=False),
    sa.Column('text_color', sa.String(length=9), nullable=False),
    sa.Column('center_mode', sa.String(length=12), nullable=False),
    sa.Column('icon_storage_filename', sa.String(length=300), nullable=True),
    sa.Column('udf_field_definition_id', sa.UUID(), nullable=True),
    sa.Column('udf_value', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['udf_field_definition_id'], ['user_defined_field_definitions.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('radial_charts')
