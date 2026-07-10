"""schedule variants and schedule periods split

Revision ID: b1aa1d32beb1
Revises: 299e01f7a78e
Create Date: 2026-07-06 12:22:19.297149

Splits Period in two (docs/SCHEDULE_VARIANTS_PLAN.md, private docs repo):
Period stays exactly as-is for Risk/Cost/ICD's own reporting cycle; a new
ScheduleVariant + SchedulePeriod pair takes over Activity and its
schedule-side siblings (ScheduleBaseline, SchedulingQualityRun), so a project
can eventually carry more than one schedule (Working Schedule, Recovery
Schedule, etc.) without dragging Risk/Cost/ICD's period reporting along with
it.

Data migration: every existing project gets exactly one ScheduleVariant
(is_master=True, name="Working Schedule"), and every existing Period row
gets a matching SchedulePeriod under that variant, preserving its label/
dates/freeze_status/baseline_locked_flag verbatim. Every Activity/
ScheduleBaseline/SchedulingQualityRun row is then repointed from the old
period_id to the new schedule_period_id via that mapping — same freeze
history, same live/frozen shape, just living under the new table. Risk/
Cost/ICD's own period_id columns (risks, cost_elements, icd_items, ...) are
completely untouched.
"""
import json
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b1aa1d32beb1'
down_revision: Union[str, None] = '299e01f7a78e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('schedule_variants',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('variant_type', sa.String(length=100), nullable=True),
    sa.Column('is_master', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_schedule_variants_project_master', 'schedule_variants', ['project_id'], unique=True, postgresql_where=sa.text('is_master'))
    op.create_table('schedule_periods',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('schedule_variant_id', sa.UUID(), nullable=False),
    sa.Column('period_label', sa.String(length=100), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('start_time', sa.Time(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('cutoff_date', sa.Date(), nullable=True),
    sa.Column('freeze_status', sa.String(length=20), nullable=False),
    sa.Column('baseline_locked_flag', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['schedule_variant_id'], ['schedule_variants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_schedule_periods_variant_live', 'schedule_periods', ['schedule_variant_id'], unique=True, postgresql_where=sa.text("freeze_status = 'live'"))

    # New FK columns added nullable first — backfilled below, then tightened
    # to NOT NULL once every existing row has a real value.
    op.add_column('activities', sa.Column('schedule_variant_id', sa.UUID(), nullable=True))
    op.add_column('activities', sa.Column('schedule_period_id', sa.UUID(), nullable=True))
    op.add_column('schedule_baselines', sa.Column('schedule_period_id', sa.UUID(), nullable=True))
    op.add_column('scheduling_quality_runs', sa.Column('schedule_period_id', sa.UUID(), nullable=True))

    conn = op.get_bind()

    # One master ScheduleVariant per project.
    project_ids = [row[0] for row in conn.execute(sa.text('SELECT id FROM projects')).fetchall()]
    variant_id_by_project: dict = {}
    for project_id in project_ids:
        variant_id = uuid.uuid4()
        variant_id_by_project[project_id] = variant_id
        conn.execute(
            sa.text(
                "INSERT INTO schedule_variants (id, project_id, name, variant_type, is_master, created_at, updated_at) "
                "VALUES (:id, :project_id, 'Working Schedule', NULL, TRUE, now(), now())"
            ),
            {"id": variant_id, "project_id": project_id},
        )

    # One SchedulePeriod per existing Period, under that project's new
    # variant — same label/dates/freeze_status/baseline_locked_flag,
    # verbatim.
    periods = conn.execute(sa.text(
        "SELECT id, project_id, period_label, start_date, start_time, end_date, cutoff_date, "
        "freeze_status, baseline_locked_flag FROM periods"
    )).fetchall()
    schedule_period_id_by_period: dict = {}
    for p in periods:
        schedule_period_id = uuid.uuid4()
        schedule_period_id_by_period[p.id] = schedule_period_id
        conn.execute(
            sa.text(
                "INSERT INTO schedule_periods "
                "(id, schedule_variant_id, period_label, start_date, start_time, end_date, cutoff_date, "
                "freeze_status, baseline_locked_flag, created_at, updated_at) "
                "VALUES (:id, :variant_id, :period_label, :start_date, :start_time, :end_date, :cutoff_date, "
                ":freeze_status, :baseline_locked_flag, now(), now())"
            ),
            {
                "id": schedule_period_id,
                "variant_id": variant_id_by_project[p.project_id],
                "period_label": p.period_label,
                "start_date": p.start_date,
                "start_time": p.start_time,
                "end_date": p.end_date,
                "cutoff_date": p.cutoff_date,
                "freeze_status": p.freeze_status,
                "baseline_locked_flag": p.baseline_locked_flag,
            },
        )

    # Repoint every Activity at its project's new variant + the SchedulePeriod
    # that replaces its old Period.
    activities = conn.execute(sa.text('SELECT id, project_id, period_id FROM activities')).fetchall()
    for a in activities:
        conn.execute(
            sa.text(
                'UPDATE activities SET schedule_variant_id = :variant_id, schedule_period_id = :schedule_period_id '
                'WHERE id = :id'
            ),
            {
                "variant_id": variant_id_by_project[a.project_id],
                "schedule_period_id": schedule_period_id_by_period[a.period_id],
                "id": a.id,
            },
        )

    for table in ('schedule_baselines', 'scheduling_quality_runs'):
        rows = conn.execute(sa.text(f'SELECT id, period_id FROM {table}')).fetchall()
        for row in rows:
            conn.execute(
                sa.text(f'UPDATE {table} SET schedule_period_id = :schedule_period_id WHERE id = :id'),
                {"schedule_period_id": schedule_period_id_by_period[row.period_id], "id": row.id},
            )

    # scheduling_quality_runs.report is a frozen JSONB blob that also embeds
    # its own period_id (as a raw string) — rewritten to the new key/value so
    # a saved report's embedded reference matches the column it now lives
    # under, same as app/services/project.py's duplicate_project already does
    # for a cloned project's own copies.
    quality_runs = conn.execute(sa.text('SELECT id, schedule_period_id, report FROM scheduling_quality_runs')).fetchall()
    for qr in quality_runs:
        report = dict(qr.report or {})
        report.pop('period_id', None)
        report['schedule_period_id'] = str(qr.schedule_period_id)
        conn.execute(
            sa.text('UPDATE scheduling_quality_runs SET report = CAST(:report AS jsonb) WHERE id = :id'),
            {"report": json.dumps(report), "id": qr.id},
        )

    op.alter_column('activities', 'schedule_variant_id', nullable=False)
    op.alter_column('activities', 'schedule_period_id', nullable=False)
    op.alter_column('schedule_baselines', 'schedule_period_id', nullable=False)
    op.alter_column('scheduling_quality_runs', 'schedule_period_id', nullable=False)

    op.drop_constraint('uq_activities_project_code', 'activities', type_='unique')
    op.create_unique_constraint('uq_activities_schedule_variant_code', 'activities', ['schedule_variant_id', 'code'])
    op.drop_constraint('activities_period_id_fkey', 'activities', type_='foreignkey')
    op.create_foreign_key(None, 'activities', 'schedule_variants', ['schedule_variant_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key(None, 'activities', 'schedule_periods', ['schedule_period_id'], ['id'], ondelete='CASCADE')
    op.drop_column('activities', 'period_id')

    op.drop_constraint('schedule_baselines_period_id_fkey', 'schedule_baselines', type_='foreignkey')
    op.create_foreign_key(None, 'schedule_baselines', 'schedule_periods', ['schedule_period_id'], ['id'], ondelete='CASCADE')
    op.drop_column('schedule_baselines', 'period_id')

    op.drop_constraint('scheduling_quality_runs_period_id_fkey', 'scheduling_quality_runs', type_='foreignkey')
    op.create_foreign_key(None, 'scheduling_quality_runs', 'schedule_periods', ['schedule_period_id'], ['id'], ondelete='CASCADE')
    op.drop_column('scheduling_quality_runs', 'period_id')


def downgrade() -> None:
    op.add_column('scheduling_quality_runs', sa.Column('period_id', sa.UUID(), autoincrement=False, nullable=True))
    op.add_column('schedule_baselines', sa.Column('period_id', sa.UUID(), autoincrement=False, nullable=True))
    op.add_column('activities', sa.Column('period_id', sa.UUID(), autoincrement=False, nullable=True))

    conn = op.get_bind()
    # Best-effort reverse mapping: a SchedulePeriod maps back to whichever
    # Period shares its (label, dates) under the same project — good enough
    # for a downgrade path, which only exists for local rollback during
    # development, not a guaranteed lossless inverse (schedule_variants
    # created after this migration ran have no Period to fall back to at
    # all, and are simply left unmapped).
    conn.execute(sa.text(
        "UPDATE activities a SET period_id = p.id "
        "FROM schedule_periods sp, periods p, schedule_variants sv "
        "WHERE a.schedule_period_id = sp.id AND sv.id = sp.schedule_variant_id "
        "AND p.project_id = sv.project_id AND p.period_label = sp.period_label"
    ))
    conn.execute(sa.text(
        "UPDATE schedule_baselines b SET period_id = p.id "
        "FROM schedule_periods sp, periods p, schedule_variants sv "
        "WHERE b.schedule_period_id = sp.id AND sv.id = sp.schedule_variant_id "
        "AND p.project_id = sv.project_id AND p.period_label = sp.period_label"
    ))
    conn.execute(sa.text(
        "UPDATE scheduling_quality_runs q SET period_id = p.id "
        "FROM schedule_periods sp, periods p, schedule_variants sv "
        "WHERE q.schedule_period_id = sp.id AND sv.id = sp.schedule_variant_id "
        "AND p.project_id = sv.project_id AND p.period_label = sp.period_label"
    ))

    op.drop_constraint(None, 'scheduling_quality_runs', type_='foreignkey')
    op.create_foreign_key('scheduling_quality_runs_period_id_fkey', 'scheduling_quality_runs', 'periods', ['period_id'], ['id'], ondelete='CASCADE')
    op.drop_column('scheduling_quality_runs', 'schedule_period_id')

    op.drop_constraint(None, 'schedule_baselines', type_='foreignkey')
    op.create_foreign_key('schedule_baselines_period_id_fkey', 'schedule_baselines', 'periods', ['period_id'], ['id'], ondelete='CASCADE')
    op.drop_column('schedule_baselines', 'schedule_period_id')

    op.drop_constraint(None, 'activities', type_='foreignkey')
    op.drop_constraint(None, 'activities', type_='foreignkey')
    op.create_foreign_key('activities_period_id_fkey', 'activities', 'periods', ['period_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('uq_activities_schedule_variant_code', 'activities', type_='unique')
    op.create_unique_constraint('uq_activities_project_code', 'activities', ['project_id', 'code'])
    op.drop_column('activities', 'schedule_period_id')
    op.drop_column('activities', 'schedule_variant_id')

    op.drop_index('uq_schedule_periods_variant_live', table_name='schedule_periods', postgresql_where=sa.text("freeze_status = 'live'"))
    op.drop_table('schedule_periods')
    op.drop_index('uq_schedule_variants_project_master', table_name='schedule_variants', postgresql_where=sa.text('is_master'))
    op.drop_table('schedule_variants')
