"""site_context: replace camera_height_m with offset/yaw/scale nudge fields

Revision ID: a1c9f3e8b7d2
Revises: feda037157c4
Create Date: 2026-08-19 16:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c9f3e8b7d2'
down_revision: Union[str, None] = 'feda037157c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The Cesium-panel design (48d18a4cf8fe) this table was originally built
# for is gone (2026-08-19, per Maro — embedding real-world tiles in the
# main viewport instead, see site_context.py's own docstring) — camera_
# height_m was purely a Cesium-camera flyover default, meaningless now.
# The new offset/yaw/scale columns are a manual nudge applied on top of
# the tileset's own real-world recentre (SiteTilesLayer.tsx).
def upgrade() -> None:
    op.drop_column('site_contexts', 'camera_height_m')
    op.add_column('site_contexts', sa.Column('offset_x', sa.Float(), nullable=False, server_default='0.0'))
    op.add_column('site_contexts', sa.Column('offset_y', sa.Float(), nullable=False, server_default='0.0'))
    op.add_column('site_contexts', sa.Column('offset_z', sa.Float(), nullable=False, server_default='0.0'))
    op.add_column('site_contexts', sa.Column('offset_yaw_deg', sa.Float(), nullable=False, server_default='0.0'))
    op.add_column('site_contexts', sa.Column('scale', sa.Float(), nullable=False, server_default='1.0'))


def downgrade() -> None:
    op.drop_column('site_contexts', 'scale')
    op.drop_column('site_contexts', 'offset_yaw_deg')
    op.drop_column('site_contexts', 'offset_z')
    op.drop_column('site_contexts', 'offset_y')
    op.drop_column('site_contexts', 'offset_x')
    op.add_column('site_contexts', sa.Column('camera_height_m', sa.Float(), nullable=False, server_default='300.0'))
