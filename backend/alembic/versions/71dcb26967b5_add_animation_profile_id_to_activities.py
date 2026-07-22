"""add animation_profile_id to activities

Revision ID: 71dcb26967b5
Revises: 3cc12b3b4560
Create Date: 2026-07-22 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '71dcb26967b5'
down_revision: Union[str, None] = '3cc12b3b4560'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activities', sa.Column('animation_profile_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_activities_animation_profile_id', 'activities', 'animation_profiles',
        ['animation_profile_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index(
        op.f('ix_activities_animation_profile_id'), 'activities', ['animation_profile_id'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_activities_animation_profile_id'), table_name='activities')
    op.drop_constraint('fk_activities_animation_profile_id', 'activities', type_='foreignkey')
    op.drop_column('activities', 'animation_profile_id')
