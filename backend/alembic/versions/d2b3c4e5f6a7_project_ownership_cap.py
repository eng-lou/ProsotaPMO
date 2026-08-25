"""project_ownership_cap

Revision ID: d2b3c4e5f6a7
Revises: c1a2b3d4e5f6
Create Date: 2026-08-25 12:30:00.000000

Projects stop being org-wide shared and become private to whoever created
them (2026-08-25, per Maro, alongside the trial/beta access gate) — a
non-super user is capped at 2 projects of their own, and a super user
shouldn't see a normal user's project data just by virtue of sharing an
org. `created_by` is added nullable first so existing rows can be backfilled
(pre-launch: every existing project was actually created while testing as
one of the bootstrap super users, so backfilling to "the org's own super
user" reflects real history, not a guess) before being locked to NOT NULL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd2b3c4e5f6a7'
down_revision: Union[str, None] = 'c1a2b3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True))

    # Prefer the org's own super user; fall back to any user in the org for
    # the rare org that (today) has none, so no row is left NULL either way.
    op.execute("""
        UPDATE projects p
        SET created_by = (
            SELECT u.id FROM users u
            WHERE u.org_id = p.org_id AND u.is_super_user = true
            ORDER BY u.created_at
            LIMIT 1
        )
        WHERE p.created_by IS NULL
    """)
    op.execute("""
        UPDATE projects p
        SET created_by = (
            SELECT u.id FROM users u
            WHERE u.org_id = p.org_id
            ORDER BY u.created_at
            LIMIT 1
        )
        WHERE p.created_by IS NULL
    """)

    op.alter_column('projects', 'created_by', nullable=False)
    op.create_foreign_key('fk_projects_created_by_users', 'projects', 'users', ['created_by'], ['id'])
    op.create_index('ix_projects_created_by', 'projects', ['created_by'])


def downgrade() -> None:
    op.drop_index('ix_projects_created_by', table_name='projects')
    op.drop_constraint('fk_projects_created_by_users', 'projects', type_='foreignkey')
    op.drop_column('projects', 'created_by')
