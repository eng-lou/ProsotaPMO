"""widen resource assignment utilisation_pct precision

Revision ID: 43fdded125d2
Revises: a2c7e4f9b381
Create Date: 2026-09-05 16:45:33.891031

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '43fdded125d2'
down_revision: Union[str, None] = 'a2c7e4f9b381'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('resource_assignments', 'utilisation_pct',
               existing_type=sa.NUMERIC(precision=5, scale=2),
               type_=sa.Numeric(precision=9, scale=6),
               existing_nullable=True)


def downgrade() -> None:
    op.alter_column('resource_assignments', 'utilisation_pct',
               existing_type=sa.Numeric(precision=9, scale=6),
               type_=sa.NUMERIC(precision=5, scale=2),
               existing_nullable=True)
