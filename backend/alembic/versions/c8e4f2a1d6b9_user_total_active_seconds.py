"""users: add total_active_seconds

Revision ID: c8e4f2a1d6b9
Revises: b3c7d1e9a4f2
Create Date: 2026-08-30 15:00:00.000000

Access Manager "time spent" (2026-08-30, per Maro: "i also want to see
how long they've spent on the app") — a running total accumulated onto
last_active_at's own throttled heartbeat in app/core/auth.py's
get_db_user, not a session table (no logout event exists to close one
against, given stateless JWT auth). See that function's own comment for
the accumulation heuristic.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8e4f2a1d6b9'
down_revision: Union[str, None] = 'b3c7d1e9a4f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('total_active_seconds', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('users', 'total_active_seconds')
