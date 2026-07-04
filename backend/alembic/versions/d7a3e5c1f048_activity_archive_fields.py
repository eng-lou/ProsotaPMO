"""activity_archive_fields

Revision ID: d7a3e5c1f048
Revises: c5f2a8b3e916
Create Date: 2026-07-04 10:10:00.000000

Archive system (2026-07-04, per Maro): archiving an activity actualises it
(pct_complete forced to 100, all its relationships stripped) and reparents
it under the period's reserved "Archived" WBS container instead of hard-
deleting it, preserving the row — and any baseline history pointing at it —
for audit/assurance. Deleting an activity that appears in a saved baseline
snapshot now archives it instead of a real delete.

is_archive_container marks the one reserved container row per period
(lazily created the first time anything is archived in that period) —
excluded from normal WBS numbering/promote-demote logic and can't itself be
deleted, archived, or targeted by indent/outdent.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7a3e5c1f048'
down_revision: Union[str, None] = 'c5f2a8b3e916'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activities', sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('activities', sa.Column('is_archive_container', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('activities', 'is_archive_container')
    op.drop_column('activities', 'is_archived')
