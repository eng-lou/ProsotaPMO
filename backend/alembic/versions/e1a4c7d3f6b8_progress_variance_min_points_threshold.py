"""progress_variance_tests: add min_points_threshold

Revision ID: e1a4c7d3f6b8
Revises: d8b2e6f4a9c1
Create Date: 2026-08-20 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1a4c7d3f6b8'
down_revision: Union[str, None] = 'd8b2e6f4a9c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Stored per-test rather than an ephemeral client-side "Run" param, so a
# test's own density calibration is remembered and reproducible across
# re-runs — see the model's own docstring and the plan's "Live-tune the
# density threshold against Maro's real data" step.
def upgrade() -> None:
    op.add_column('progress_variance_tests', sa.Column('min_points_threshold', sa.Integer(), nullable=False, server_default='3'))


def downgrade() -> None:
    op.drop_column('progress_variance_tests', 'min_points_threshold')
