"""user_last_active_at

Revision ID: e3f4a5b6c7d8
Revises: d2b3c4e5f6a7
Create Date: 2026-08-25 15:00:00.000000

Access Manager "current users" list (2026-08-25, per Maro — moved from
Sidebar's Access Requests panel to the Project Selector page, renamed, and
extended to show approved users alongside pending ones): adds a single
nullable timestamp, throttled-updated in get_db_user, no backfill needed —
NULL just means "never recorded yet" for any existing row.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, None] = 'd2b3c4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('last_active_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'last_active_at')
