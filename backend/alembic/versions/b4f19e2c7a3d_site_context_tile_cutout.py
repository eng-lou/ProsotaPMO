"""site_context_tile_cutout

Revision ID: b4f19e2c7a3d
Revises: 29318ba6378e
Create Date: 2026-09-02 00:00:00.000000

Tile Cutout (2026-09-02, per Maro: "add a polygon like the zones but this
will allow me to actually clip the 3d tile so i can have my ifc model or
3d in that space"). Reuses an existing Zone's own footprint (zone.py)
rather than a second polygon-drawing system — see site_context.py's own
model docstring for the full "why", including the v1 convex-only /
single-cutout scope.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b4f19e2c7a3d'
down_revision: Union[str, None] = '29318ba6378e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('site_contexts', sa.Column('cutout_zone_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('site_contexts', sa.Column('cutout_active', sa.Boolean(), nullable=False, server_default='false'))
    op.create_foreign_key(
        'fk_site_contexts_cutout_zone_id', 'site_contexts', 'zones', ['cutout_zone_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_site_contexts_cutout_zone_id', 'site_contexts', type_='foreignkey')
    op.drop_column('site_contexts', 'cutout_active')
    op.drop_column('site_contexts', 'cutout_zone_id')
