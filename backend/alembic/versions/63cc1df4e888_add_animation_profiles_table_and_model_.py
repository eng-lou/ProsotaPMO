"""add animation_profiles table and model_element_links.animation_profile_id

Revision ID: 63cc1df4e888
Revises: 9f56221bd8f3
Create Date: 2026-07-08 12:16:04.395836

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '63cc1df4e888'
down_revision: Union[str, None] = '9f56221bd8f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('animation_profiles',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.add_column('model_element_links', sa.Column('animation_profile_id', sa.UUID(), nullable=True))
    op.create_foreign_key('fk_model_element_links_animation_profile_id', 'model_element_links', 'animation_profiles', ['animation_profile_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_model_element_links_animation_profile_id', 'model_element_links', type_='foreignkey')
    op.drop_column('model_element_links', 'animation_profile_id')
    op.drop_table('animation_profiles')
