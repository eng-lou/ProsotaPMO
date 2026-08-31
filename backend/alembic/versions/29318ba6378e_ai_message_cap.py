"""ai_message_cap

Revision ID: 29318ba6378e
Revises: c8e4f2a1d6b9
Create Date: 2026-08-31 15:13:14.090711

Per-user daily cap on the AI assistant (2026-08-31, per Maro: "add a user
cap, except for superuser"). See require_ai_quota in app/core/auth.py for
how these two columns are actually checked/reset; ai_messages_reset_date
nullable so existing rows don't need a backfill — NULL is treated as "not
today" the first time it's checked, which resets to 0 and stamps today.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '29318ba6378e'
down_revision: Union[str, None] = 'c8e4f2a1d6b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('ai_messages_today', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('ai_messages_reset_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'ai_messages_reset_date')
    op.drop_column('users', 'ai_messages_today')
