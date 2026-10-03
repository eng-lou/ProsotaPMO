"""HUD per comparison view: viewport_slot on radial charts + timeline strips; strips become a list

Revision ID: b4d9e1a7c352
Revises: e7a2c4f19b30
Create Date: 2026-10-03

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b4d9e1a7c352'
down_revision: Union[str, None] = 'e7a2c4f19b30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('radial_charts', sa.Column('viewport_slot', sa.Integer(), nullable=True))
    op.add_column('timeline_strips', sa.Column('viewport_slot', sa.Integer(), nullable=True))
    op.add_column('timeline_strips', sa.Column('title', sa.String(length=300), nullable=False, server_default='Timeline Strip'))
    # The original table's UNIQUE(project_id) was created unnamed, so drop
    # whatever name Postgres gave it rather than assuming one.
    op.execute("""
        DO $$
        DECLARE c text;
        BEGIN
          SELECT conname INTO c FROM pg_constraint
          WHERE conrelid = 'timeline_strips'::regclass AND contype = 'u';
          IF c IS NOT NULL THEN
            EXECUTE format('ALTER TABLE timeline_strips DROP CONSTRAINT %I', c);
          END IF;
        END $$;
    """)
    op.create_index('ix_timeline_strips_project_id', 'timeline_strips', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_timeline_strips_project_id', table_name='timeline_strips')
    # Keep only the oldest strip per project so the singleton constraint
    # can come back.
    op.execute("""
        DELETE FROM timeline_strips t USING timeline_strips o
        WHERE t.project_id = o.project_id AND t.created_at > o.created_at
    """)
    op.create_unique_constraint('timeline_strips_project_id_key', 'timeline_strips', ['project_id'])
    op.drop_column('timeline_strips', 'title')
    op.drop_column('timeline_strips', 'viewport_slot')
    op.drop_column('radial_charts', 'viewport_slot')
