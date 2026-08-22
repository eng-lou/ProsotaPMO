"""model3d_files: add keep_raw_animation

Revision ID: b7e4f1a9c3d6
Revises: a3d9c6e1f2b4
Create Date: 2026-08-22 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7e4f1a9c3d6'
down_revision: Union[str, None] = 'a3d9c6e1f2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# See Model3DFile.keep_raw_animation's own docstring (2026-08-22, per
# Maro's own real Blender particle-VFX export, "Water Spray.glb") — tells
# the restore-on-mount path whether to keep a mesh import's own raw
# embedded animation (a particle sim this app can never bake to schedule
# keyframes) instead of stripping it the way an already-baked import's
# animation correctly gets stripped on every reload.
def upgrade() -> None:
    op.add_column('model3d_files', sa.Column('keep_raw_animation', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('model3d_files', 'keep_raw_animation')
