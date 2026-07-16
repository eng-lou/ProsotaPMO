"""default whole_day_scheduling to true for all calendars

Revision ID: 0671e1c5ac52
Revises: ecf213968324
Create Date: 2026-07-13 19:42:06.914775

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0671e1c5ac52'
down_revision: Union[str, None] = 'ecf213968324'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


calendars = sa.table("calendars", sa.column("whole_day_scheduling", sa.Boolean()))


def upgrade() -> None:
    # 2026-07-13, per Maro: "let it be whole day by default" for every
    # calendar, not just new ones — this backfills every existing calendar
    # row, not only calendars created after this migration. The column
    # default also flips to true so any insert that bypasses the ORM's own
    # default (raw SQL, a future migration) still lands correctly.
    op.execute(calendars.update().values(whole_day_scheduling=True))
    op.alter_column("calendars", "whole_day_scheduling", server_default=sa.true())


def downgrade() -> None:
    op.alter_column("calendars", "whole_day_scheduling", server_default=sa.false())
    op.execute(calendars.update().values(whole_day_scheduling=False))
