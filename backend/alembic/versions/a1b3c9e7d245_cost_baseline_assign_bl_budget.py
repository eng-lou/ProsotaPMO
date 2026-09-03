"""cost baseline assign + bl_budget

Revision ID: a1b3c9e7d245
Revises: d90be24d117e
Create Date: 2026-09-03 15:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1b3c9e7d245'
down_revision: Union[str, None] = 'd90be24d117e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Hand-written, not raw autogenerate output (2026-09-03) — same reasoning as
# d90be24d117e: autogenerate also picks up a large amount of unrelated
# pre-existing drift between this dev DB and the models. Just the two real
# changes for this domain correction (per Maro: "the budget field in cost
# plan is a forecast... the baseline of the figures becomes the approved
# budget... we can create multiple baselines and choose to assign a
# particular baseline as the budget figures to measure against"):
#
# - cost_baselines.is_active: mirrors schedule_baselines' own column —
#   whichever Cost Baseline is assigned, false for everyone until that
#   deliberate action is ever taken, so a plain nullable=False default=false
#   column needs no backfill logic.
# - cost_elements.bl_budget: the true Budget At Completion, synced from
#   whichever Cost Baseline is assigned (nothing has been assigned yet
#   anywhere, so this starts NULL for every row, same "no baseline = no
#   reference point" rule the rest of this app already uses) — and
#   rev_a_baseline (the old, retired "frozen once at creation" mechanism
#   this replaces) is dropped.


def upgrade() -> None:
    op.add_column('cost_baselines', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('cost_baselines', 'is_active', server_default=None)

    op.add_column('cost_elements', sa.Column('bl_budget', sa.Numeric(14, 2), nullable=True))
    op.drop_column('cost_elements', 'rev_a_baseline')


def downgrade() -> None:
    op.add_column('cost_elements', sa.Column('rev_a_baseline', sa.Numeric(14, 2), nullable=True))
    op.drop_column('cost_elements', 'bl_budget')

    op.drop_column('cost_baselines', 'is_active')
