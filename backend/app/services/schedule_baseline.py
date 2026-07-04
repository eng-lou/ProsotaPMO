from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.period import Period
from app.models.schedule_baseline import ScheduleBaseline, ScheduleBaselineActivity
from app.schemas.schedule_baseline import ScheduleBaselineCreate
from app.services.activity import _attach_evm_fields, _require_live_period


async def _attach_activity_counts(db: AsyncSession, baselines: list[ScheduleBaseline]) -> None:
    if not baselines:
        return
    result = await db.execute(
        select(ScheduleBaselineActivity.baseline_id, func.count())
        .where(ScheduleBaselineActivity.baseline_id.in_([b.id for b in baselines]))
        .group_by(ScheduleBaselineActivity.baseline_id)
    )
    counts = dict(result.all())
    for b in baselines:
        b.activity_count = counts.get(b.id, 0)


async def create_baseline(db: AsyncSession, data: ScheduleBaselineCreate) -> ScheduleBaseline:
    """Snapshots every activity's current start/finish/duration_hours under a
    new named, dated baseline. Deliberately does NOT assign it — per Maro,
    "set a baseline" (capture) and "assign a baseline" (apply) are two
    separate, deliberate actions, not one combined step. See
    assign_baseline below for the apply half."""
    period = await db.get(Period, data.period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    await _require_live_period(db, data.period_id)

    baseline = ScheduleBaseline(period_id=data.period_id, name=data.name, baseline_date=data.baseline_date)
    db.add(baseline)
    await db.flush()

    result = await db.execute(select(Activity).where(Activity.period_id == data.period_id))
    activities = list(result.scalars().all())
    for a in activities:
        db.add(ScheduleBaselineActivity(
            baseline_id=baseline.id, activity_id=a.id, code=a.code,
            start=a.start, finish=a.finish, duration_hours=a.duration_hours,
        ))

    await db.commit()
    await db.refresh(baseline)
    baseline.activity_count = len(activities)
    return baseline


async def get_baseline_snapshot(db: AsyncSession, baseline_id: uuid.UUID) -> list[ScheduleBaselineActivity]:
    """Every activity's captured code/start/finish/duration_hours as of this
    baseline (2026-07-04, per Maro: "what it was in the baseline" traceability) —
    distinct from the live activity's current values, which may have moved on."""
    baseline = await db.get(ScheduleBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    result = await db.execute(
        select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id == baseline_id)
    )
    return list(result.scalars().all())


async def list_baselines(db: AsyncSession, period_id: uuid.UUID) -> list[ScheduleBaseline]:
    result = await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.period_id == period_id)
        .order_by(ScheduleBaseline.baseline_date.desc(), ScheduleBaseline.created_at.desc())
    )
    baselines = list(result.scalars().all())
    await _attach_activity_counts(db, baselines)
    return baselines


async def _clear_baseline_fields(db: AsyncSession, period_id: uuid.UUID) -> list[Activity]:
    """Nulls bl_start/bl_finish/bl_duration_hours/variance_days on every
    activity in a period — used whenever the period's active baseline goes
    away (deleted or unassigned) and those figures have no reference point
    left to reflect.

    Load-mutate-flush-then-refresh-each, deliberately not a bulk UPDATE: a
    bulk UPDATE's synchronize_session="evaluate" only syncs the columns
    actually named in .values() onto already-loaded in-memory objects —
    since it can't know the new server-computed value of `updated_at`
    (onupdate=func.now(), not part of this update), it instead expires that
    attribute on those objects, and a later request sharing this same
    session (as the test client does) can then hit a synchronous re-fetch of
    that expired attribute outside an active greenlet — MissingGreenlet.
    Explicitly refreshing each object after flush, as assign_baseline
    already does after its own commit, avoids that entirely."""
    act_result = await db.execute(select(Activity).where(Activity.period_id == period_id))
    activities = list(act_result.scalars().all())
    for a in activities:
        a.bl_start = None
        a.bl_finish = None
        a.bl_duration_hours = None
        a.variance_days = None
    await db.flush()
    for a in activities:
        await db.refresh(a)
    return activities


async def assign_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> list[Activity]:
    """Copies a saved baseline's snapshot into bl_start/bl_finish/
    bl_duration_hours on every activity in its period — the same effect the
    old one-shot "Set Baseline" action had, just sourced from a chosen saved
    capture instead of "right now". Activities created after the baseline was
    captured (no snapshot row) get their bl_* fields cleared to null rather
    than left stale from whatever was previously assigned — they genuinely
    have no reference point in this baseline.

    Also flips is_active: only one baseline per period is ever active at a
    time, so every other baseline in the same period gets is_active=False
    first."""
    baseline = await db.get(ScheduleBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_period(db, baseline.period_id)

    siblings_result = await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.period_id == baseline.period_id)
    )
    for sibling in siblings_result.scalars().all():
        sibling.is_active = sibling.id == baseline.id

    snap_result = await db.execute(
        select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id == baseline_id)
    )
    snapshots = {s.activity_id: s for s in snap_result.scalars().all()}

    act_result = await db.execute(select(Activity).where(Activity.period_id == baseline.period_id))
    activities = list(act_result.scalars().all())
    for a in activities:
        snap = snapshots.get(a.id)
        a.bl_start = snap.start if snap else None
        a.bl_finish = snap.finish if snap else None
        a.bl_duration_hours = snap.duration_hours if snap else None
        a.variance_days = (
            (a.finish - a.bl_finish).days if a.finish is not None and a.bl_finish is not None else None
        )

    await db.commit()
    for a in activities:
        await db.refresh(a)
    await _attach_evm_fields(db, activities)
    return activities


async def delete_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> None:
    baseline = await db.get(ScheduleBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_period(db, baseline.period_id)

    if baseline.is_active:
        # Every activity's bl_start/bl_finish/bl_duration_hours/variance_days
        # currently holds *this* baseline's snapshot (assign_baseline copied
        # it in) — with the baseline gone, those figures have no reference
        # point left and must clear, the same "no snapshot = null, not stale"
        # rule assign_baseline already applies to activities created after a
        # capture. Previously left untouched, which meant BL Start/BL Finish
        # and Fin. Var (d) kept showing a deleted baseline's numbers
        # indefinitely, in both the table and the Gantt.
        await _clear_baseline_fields(db, baseline.period_id)

    # ScheduleBaselineActivity rows cascade via the FK's ON DELETE CASCADE. If
    # this was the active one, there's simply no baseline with is_active=True
    # for this period anymore — no cross-table pointer to clean up, since
    # is_active lives on this table, not a Period back-reference.
    await db.delete(baseline)
    await db.commit()


async def unassign_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> list[Activity]:
    """The opposite of assign_baseline: clears is_active without deleting the
    saved baseline (2026-07-04, per Maro — "I want to be able to unassign
    after I assign a baseline"). Every activity's bl_start/bl_finish/
    bl_duration_hours/variance_days clears exactly as if the baseline had
    been deleted, but it stays in the saved list to be assigned again later."""
    baseline = await db.get(ScheduleBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_period(db, baseline.period_id)
    if not baseline.is_active:
        raise HTTPException(status_code=422, detail="This baseline isn't currently assigned")

    baseline.is_active = False
    activities = await _clear_baseline_fields(db, baseline.period_id)  # already flushed + refreshed

    await db.commit()
    await _attach_evm_fields(db, activities)
    return activities
