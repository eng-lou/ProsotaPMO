"""annotation leader offset horizontal default

Revision ID: dbf09b8e39e7
Revises: 9f82b012f6ba
Create Date: 2026-07-30

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'dbf09b8e39e7'
down_revision = '9f82b012f6ba'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 2026-07-30, per Maro's reference screenshot ("NOISE SENSITIVE AREA"
    # style callout — level with its target, offset sideways, near-horizontal
    # line) — the (0, 0.6, 0) fixed-stem-style default from the migration
    # just before this one produced a tall vertical leader instead. Only the
    # server_default changes here (existing rows keep whatever they already
    # have); newly created annotations now start at (2.0, 0.0, 0.0).
    op.alter_column('annotations', 'leader_offset_x', server_default='2.0')
    op.alter_column('annotations', 'leader_offset_y', server_default='0.0')


def downgrade() -> None:
    op.alter_column('annotations', 'leader_offset_x', server_default='0.0')
    op.alter_column('annotations', 'leader_offset_y', server_default='0.6')
