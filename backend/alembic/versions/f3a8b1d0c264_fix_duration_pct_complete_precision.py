"""fix activities.duration_pct_complete precision (0-100 scale needs 3 digits before the point, not 1)

Revision ID: f3a8b1d0c264
Revises: d9e2c5a4f716
Create Date: 2026-09-04 00:00:00.000001

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f3a8b1d0c264'
down_revision: Union[str, None] = 'd9e2c5a4f716'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'activities', 'duration_pct_complete',
        existing_type=sa.Numeric(9, 8), type_=sa.Numeric(12, 8), existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        'activities', 'duration_pct_complete',
        existing_type=sa.Numeric(12, 8), type_=sa.Numeric(9, 8), existing_nullable=True,
    )
