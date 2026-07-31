"""annotation leader offset and animate fields

Revision ID: 9f82b012f6ba
Revises: 4da4b8392ee4
Create Date: 2026-08-06

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '9f82b012f6ba'
down_revision = '4da4b8392ee4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('annotations', sa.Column('leader_offset_x', sa.Float(), nullable=False, server_default='0.0'))
    # 0.6 matches AnnotationMarker.tsx's own former hardcoded BOX_STEM_HEIGHT
    # (2026-08-06) — existing rows keep rendering at exactly the same
    # callout height they always have, now as an editable field instead of
    # a constant.
    op.add_column('annotations', sa.Column('leader_offset_y', sa.Float(), nullable=False, server_default='0.6'))
    op.add_column('annotations', sa.Column('leader_offset_z', sa.Float(), nullable=False, server_default='0.0'))
    op.add_column('annotations', sa.Column('animate_leader', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('annotations', sa.Column('leader_animation_loop', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('annotations', 'leader_animation_loop')
    op.drop_column('annotations', 'animate_leader')
    op.drop_column('annotations', 'leader_offset_z')
    op.drop_column('annotations', 'leader_offset_y')
    op.drop_column('annotations', 'leader_offset_x')
