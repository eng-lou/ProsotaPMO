"""add cost element comparison_cost

Revision ID: 18a5d2e28cef
Revises: a4eebab4c4f3
Create Date: 2026-07-18 10:46:01.337814

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '18a5d2e28cef'
down_revision: Union[str, None] = 'a4eebab4c4f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate also proposed dropping/recreating several unrelated
    # unique constraints (uq_cost_elements_project_code, risks, icd_items,
    # etc.) — pure SQLAlchemy-reflection drift (postgresql_nulls_not_distinct
    # comparison), not a real model change, and not something this migration
    # should touch. Trimmed to just the one real change.
    op.add_column('cost_elements', sa.Column('comparison_cost', sa.Numeric(precision=14, scale=2), nullable=True))


def downgrade() -> None:
    op.drop_column('cost_elements', 'comparison_cost')
