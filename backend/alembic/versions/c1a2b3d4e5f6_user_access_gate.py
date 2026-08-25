"""user_access_gate

Revision ID: c1a2b3d4e5f6
Revises: b7e4f1a9c3d6
Create Date: 2026-08-25 10:00:00.000000

Trial/beta access-control gate (2026-08-25, per Maro): Auth0 login (Google,
etc.) is open to anyone, but until now `get_db_user` auto-provisioned any
authenticated caller as a full role="admin" user on first API call, no
allowlist at all. `status` gates real app access ("pending" until a super
user approves), `is_super_user` marks who can review/approve pending users,
and `requested_title`/`requested_organisation`/`requested_at` capture what
someone submits on the in-app "Request Access" form. Existing rows are
backfilled: Maro's two known accounts are auto-approved as super users,
everyone else defaults to "pending" via the column's own server_default —
safe today since this is pre-launch and only Maro's own account exists.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, None] = 'b7e4f1a9c3d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'))
    op.add_column('users', sa.Column('is_super_user', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('users', sa.Column('requested_title', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('requested_organisation', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('requested_at', sa.DateTime(timezone=True), nullable=True))

    op.execute("""
        UPDATE users
        SET status = 'approved', is_super_user = true
        WHERE email IN ('sotalouisx@gmail.com', 'lsota@prosota.com')
    """)


def downgrade() -> None:
    op.drop_column('users', 'requested_at')
    op.drop_column('users', 'requested_organisation')
    op.drop_column('users', 'requested_title')
    op.drop_column('users', 'is_super_user')
    op.drop_column('users', 'status')
