"""add element_splits table

Revision ID: d1d242eaf490
Revises: 0671e1c5ac52
Create Date: 2026-07-15 12:36:46.921680

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd1d242eaf490'
down_revision: Union[str, None] = '0671e1c5ac52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Note: autogenerate also detected several unrelated unique-constraint
    # metadata differences (cost_elements/cost_variance_criteria/
    # icd_criteria/icd_items/risk_impact_criteria/
    # risk_mitigation_actions/risk_probability_criteria/risks) — pre-existing
    # drift unrelated to this change (a postgresql_nulls_not_distinct
    # comparison quirk, same one noted in ecf213968324's own migration),
    # deliberately left out of this migration.
    op.create_table('element_splits',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('source_kind', sa.String(length=10), nullable=False),
    sa.Column('element_ref', sa.String(length=300), nullable=False),
    sa.Column('cut_elevations_m', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'source_kind', 'element_ref', name='uq_element_splits_project_element')
    )


def downgrade() -> None:
    op.drop_table('element_splits')
