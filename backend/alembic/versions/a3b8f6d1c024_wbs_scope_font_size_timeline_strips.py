"""wbs scope, font size controls, and timeline strips table

Revision ID: a3b8f6d1c024
Revises: e7f4a1c9b352
Create Date: 2026-08-03

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a3b8f6d1c024'
down_revision = 'e7f4a1c9b352'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # RadialChart: WBS scoping alongside the existing UDF filter, plus a
    # font size control.
    op.add_column('radial_charts', sa.Column('scope_mode', sa.String(length=10), nullable=False, server_default='all'))
    op.add_column('radial_charts', sa.Column('wbs_node_activity_id', sa.UUID(), nullable=True))
    op.add_column('radial_charts', sa.Column('font_size', sa.Float(), nullable=False, server_default='14.0'))
    op.create_foreign_key(
        'fk_radial_charts_wbs_node_activity_id', 'radial_charts', 'activities',
        ['wbs_node_activity_id'], ['id'], ondelete='SET NULL',
    )
    # Every already-shipped chart with a UDF filter set keeps behaving
    # identically; everything else defaults to 'all', matching the prior
    # "null fields = all activities" behaviour exactly.
    op.execute("UPDATE radial_charts SET scope_mode = 'udf' WHERE udf_field_definition_id IS NOT NULL")

    # Zone: label font size control.
    op.add_column('zones', sa.Column('label_font_size', sa.Float(), nullable=False, server_default='15.0'))

    # TimelineStrip: new singleton-per-project resource.
    op.create_table('timeline_strips',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('visible', sa.Boolean(), nullable=False),
    sa.Column('position_x_pct', sa.Float(), nullable=False),
    sa.Column('position_y_pct', sa.Float(), nullable=False),
    sa.Column('width_px', sa.Float(), nullable=False),
    sa.Column('height_px', sa.Float(), nullable=False),
    sa.Column('background_color', sa.String(length=9), nullable=False),
    sa.Column('band_border_color', sa.String(length=9), nullable=False),
    sa.Column('text_color', sa.String(length=9), nullable=False),
    sa.Column('playhead_color', sa.String(length=9), nullable=False),
    sa.Column('font_size', sa.Float(), nullable=False),
    sa.Column('scope_mode', sa.String(length=10), nullable=False),
    sa.Column('udf_field_definition_id', sa.UUID(), nullable=True),
    sa.Column('udf_value', sa.String(length=500), nullable=True),
    sa.Column('wbs_node_activity_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['udf_field_definition_id'], ['user_defined_field_definitions.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['wbs_node_activity_id'], ['activities.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id'),
    )


def downgrade() -> None:
    op.drop_table('timeline_strips')
    op.drop_column('zones', 'label_font_size')
    op.drop_constraint('fk_radial_charts_wbs_node_activity_id', 'radial_charts', type_='foreignkey')
    op.drop_column('radial_charts', 'font_size')
    op.drop_column('radial_charts', 'wbs_node_activity_id')
    op.drop_column('radial_charts', 'scope_mode')
