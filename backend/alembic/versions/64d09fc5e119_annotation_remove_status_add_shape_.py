"""annotation remove status, add box_shape, rename animate fields

Revision ID: 64d09fc5e119
Revises: dbf09b8e39e7
Create Date: 2026-07-30

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '64d09fc5e119'
down_revision = 'dbf09b8e39e7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 2026-07-30, per Maro: "remove the resolved comment feature" — Comment
    # carries no review-workflow state of its own any more.
    op.drop_column('annotations', 'status')
    # per Maro: "allow me to pick a standard rectangle shape" for the
    # callout box — 'rounded' keeps every existing row's original look.
    op.add_column('annotations', sa.Column('box_shape', sa.String(12), nullable=False, server_default='rounded'))
    # per Maro: "the animate leader feature is not just about the leader
    # its the whole thing" — renamed to match Path/Zone's own animate/
    # animation_loop naming now that it gates the whole annotation, not
    # just the leader line.
    op.alter_column('annotations', 'animate_leader', new_column_name='animate')
    op.alter_column('annotations', 'leader_animation_loop', new_column_name='animation_loop')


def downgrade() -> None:
    op.alter_column('annotations', 'animation_loop', new_column_name='leader_animation_loop')
    op.alter_column('annotations', 'animate', new_column_name='animate_leader')
    op.drop_column('annotations', 'box_shape')
    op.add_column('annotations', sa.Column('status', sa.String(10), nullable=False, server_default='open'))
