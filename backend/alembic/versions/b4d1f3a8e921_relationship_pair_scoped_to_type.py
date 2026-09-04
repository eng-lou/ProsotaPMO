"""scope activity relationship uniqueness to include type

Revision ID: b4d1f3a8e921
Revises: a1b3c9e7d245
Create Date: 2026-09-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b4d1f3a8e921'
down_revision: Union[str, None] = 'a1b3c9e7d245'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('uq_activity_relationship_pair', 'activity_relationships', type_='unique')
    op.create_unique_constraint(
        'uq_activity_relationship_pair', 'activity_relationships',
        ['predecessor_id', 'successor_id', 'relationship_type'],
    )


def downgrade() -> None:
    op.drop_constraint('uq_activity_relationship_pair', 'activity_relationships', type_='unique')
    op.create_unique_constraint(
        'uq_activity_relationship_pair', 'activity_relationships', ['predecessor_id', 'successor_id'],
    )
