"""move path/zone animation start/end to element_keyframes

Revision ID: ed6ace420162
Revises: b0181d1704b6
Create Date: 2026-07-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'ed6ace420162'
down_revision: Union[str, None] = 'b0181d1704b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Data-preserving move (2026-07-30, per Maro: "if i keyframe i should
    # see the path actor in the timeline with both keyframes so i can
    # drag, delete etc") — any path/zone that already had a real
    # animation_start/animation_end set (from the previous, plain-column
    # version of this feature) gets an equivalent ElementKeyframe row
    # instead, rather than silently losing that already-configured reveal
    # window. value=0 — see element_keyframe.py's own KeyframeField header:
    # an anim_start/anim_end row's `date` *is* the value, `value` itself is
    # unused for this field, same convention as a plain marker keyframe.
    op.execute(
        """
        INSERT INTO element_keyframes (id, project_id, source_kind, element_ref, field, date, value, created_at, updated_at)
        SELECT gen_random_uuid(), project_id, 'path', id::text, 'anim_start', animation_start, 0, now(), now()
        FROM paths WHERE animation_start IS NOT NULL
        """
    )
    op.execute(
        """
        INSERT INTO element_keyframes (id, project_id, source_kind, element_ref, field, date, value, created_at, updated_at)
        SELECT gen_random_uuid(), project_id, 'path', id::text, 'anim_end', animation_end, 0, now(), now()
        FROM paths WHERE animation_end IS NOT NULL
        """
    )
    op.execute(
        """
        INSERT INTO element_keyframes (id, project_id, source_kind, element_ref, field, date, value, created_at, updated_at)
        SELECT gen_random_uuid(), project_id, 'zone', id::text, 'anim_start', animation_start, 0, now(), now()
        FROM zones WHERE animation_start IS NOT NULL
        """
    )
    op.execute(
        """
        INSERT INTO element_keyframes (id, project_id, source_kind, element_ref, field, date, value, created_at, updated_at)
        SELECT gen_random_uuid(), project_id, 'zone', id::text, 'anim_end', animation_end, 0, now(), now()
        FROM zones WHERE animation_end IS NOT NULL
        """
    )
    op.drop_column('paths', 'animation_start')
    op.drop_column('paths', 'animation_end')
    op.drop_column('zones', 'animation_start')
    op.drop_column('zones', 'animation_end')


def downgrade() -> None:
    # Columns restored empty — the reverse data move (element_keyframes ->
    # columns) isn't attempted; a downgrade this deep after the keyframe
    # rework isn't a realistic path back, same as every other irreversible
    # data-shape migration in this project.
    op.add_column('paths', sa.Column('animation_start', sa.DateTime(timezone=True), nullable=True))
    op.add_column('paths', sa.Column('animation_end', sa.DateTime(timezone=True), nullable=True))
    op.add_column('zones', sa.Column('animation_start', sa.DateTime(timezone=True), nullable=True))
    op.add_column('zones', sa.Column('animation_end', sa.DateTime(timezone=True), nullable=True))
