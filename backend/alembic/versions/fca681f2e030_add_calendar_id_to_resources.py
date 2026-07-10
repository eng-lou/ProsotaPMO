"""add calendar_id to resources

Revision ID: fca681f2e030
Revises: 69627bc04b69
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'fca681f2e030'
down_revision: Union[str, None] = '69627bc04b69'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('resources', sa.Column('calendar_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'resources_calendar_id_fkey', 'resources', 'calendars', ['calendar_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('resources_calendar_id_fkey', 'resources', type_='foreignkey')
    op.drop_column('resources', 'calendar_id')
