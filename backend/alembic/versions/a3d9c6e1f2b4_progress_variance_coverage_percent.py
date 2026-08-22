"""progress_variance: replace min_points_threshold with min_coverage_percent, add coverage_percent to results

Revision ID: a3d9c6e1f2b4
Revises: e1a4c7d3f6b8
Create Date: 2026-08-21 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3d9c6e1f2b4'
down_revision: Union[str, None] = 'e1a4c7d3f6b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# PROSOTA PATCH (2026-08-21) — a raw scan-point count inside an element's
# whole bounding box couldn't distinguish "10% poured" from "90% poured";
# replaced with a % of the element's own sampled surface the scan actually
# confirms (see progress_variance_test.py's and progress_variance_result.py's
# own updated docstrings). No production data depends on this
# still-unreleased feature (first real end-to-end test happened this
# session), so a clean rename rather than an add-new/drop-old migration.
def upgrade() -> None:
    op.alter_column(
        'progress_variance_tests', 'min_points_threshold',
        new_column_name='min_coverage_percent',
        type_=sa.Float(), postgresql_using='min_points_threshold::float',
        server_default='50.0',
    )
    op.add_column('progress_variance_results', sa.Column('coverage_percent', sa.Float(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('progress_variance_results', 'coverage_percent')
    op.alter_column(
        'progress_variance_tests', 'min_coverage_percent',
        new_column_name='min_points_threshold',
        type_=sa.Integer(), postgresql_using='min_coverage_percent::integer',
        server_default='3',
    )
