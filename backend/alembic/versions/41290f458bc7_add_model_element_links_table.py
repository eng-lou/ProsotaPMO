"""add model_element_links table

Revision ID: 41290f458bc7
Revises: 0c2dda38cc64
Create Date: 2026-07-08 09:37:26.064357

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '41290f458bc7'
down_revision: Union[str, None] = '0c2dda38cc64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('model_element_links',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('activity_id', sa.UUID(), nullable=False),
    sa.Column('source_kind', sa.String(length=10), nullable=False),
    sa.Column('element_ref', sa.String(length=300), nullable=False),
    sa.Column('element_label', sa.String(length=300), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['activity_id'], ['activities.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('activity_id', 'source_kind', 'element_ref', name='uq_model_element_links_activity_element')
    )


def downgrade() -> None:
    op.drop_table('model_element_links')
