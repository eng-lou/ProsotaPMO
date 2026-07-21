"""add viewport_state and thumbnail_data_url to camera_views

Revision ID: 0781dab0dadc
Revises: 736bac466fb3
Create Date: 2026-07-20 19:30:08.596542

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0781dab0dadc'
down_revision: Union[str, None] = '736bac466fb3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('camera_views', sa.Column('viewport_state', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('camera_views', sa.Column('thumbnail_data_url', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('camera_views', 'thumbnail_data_url')
    op.drop_column('camera_views', 'viewport_state')
