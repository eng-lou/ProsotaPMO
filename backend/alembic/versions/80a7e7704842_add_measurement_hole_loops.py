"""add measurement hole_loops

Revision ID: 80a7e7704842
Revises: 53f3192f7f14
Create Date: 2026-07-19 11:44:44.643730

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '80a7e7704842'
down_revision: Union[str, None] = '53f3192f7f14'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default backfills every existing measurement row to an empty
    # list (correct — hole_loops is only ever populated by a face-clicked
    # area measurement, none of which existed before this column did)
    # before the NOT NULL constraint applies; dropped right after so new
    # rows rely on the ORM-side default instead, same pattern this history
    # already uses for a new non-nullable column (e.g. calendars'
    # whole_day_scheduling).
    op.add_column('measurements', sa.Column(
        'hole_loops', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]',
    ))
    op.alter_column('measurements', 'hole_loops', server_default=None)


def downgrade() -> None:
    op.drop_column('measurements', 'hole_loops')
