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
            baseline_id=baseline.id, activity_id=a.id,
            start=a.start, finish=a.finish, duration_hours=a.duration_hours,
        ))

    await db.commit()
    await db.refresh(baseline)
    baseline.activity_count = len(activities)
    return baseline


async def list_baselines(db: AsyncSession, period_id: uuid.UUID) -> list[ScheduleBaseline]:
    result = await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.period_id == period_id)
        .order_by(ScheduleBaseline.baseline_date.desc(), ScheduleBaseline.created_at.desc())
    )
    baselines = list(result.scalars().all())
    await _attach_activity_counts(db, baselines)
    return baselines


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
    # ScheduleBaselineActivity rows cascade via the FK's ON DELETE CASCADE. If
    # this was the active one, there's simply no baseline with is_active=True
    # for this period anymore — no cross-table pointer to clean up, since
    # is_active lives on this table, not a Period back-reference.
    await db.delete(baseline)
    await db.commit()
