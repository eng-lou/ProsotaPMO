"""site_context: add elevation field

Revision ID: b3c7d1e9a4f2
Revises: a1b2c3d4e5f7
Create Date: 2026-08-30 12:00:00.000000

Real-world height above the WGS84 ellipsoid, in metres, at the saved
lat/lon (2026-08-30, per Maro: "yes add elevation input") — fed straight
into getEastNorthUpFrame's own height parameter in SiteTilesLayer.tsx
(previously hardcoded to 0), so a site that isn't at sea level actually
recentres its tileset at the right real-world height instead of always
assuming the ellipsoid surface. Distinct from offset_z (a1c9f3e8b7d2),
which is a manual local-scene-unit nudge applied on top of this recentre,
not a real-world value.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3c7d1e9a4f2'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('site_contexts', sa.Column('elevation', sa.Float(), nullable=False, server_default='0.0'))


def downgrade() -> None:
    op.drop_column('site_contexts', 'elevation')
