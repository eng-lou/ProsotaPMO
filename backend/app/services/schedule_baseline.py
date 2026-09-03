from __future__ import annotations

import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_code_history import ActivityCodeHistory
from app.models.activity_relationship import ActivityRelationship
from app.models.resource_assignment import ResourceAssignment
from app.models.schedule_baseline import ScheduleBaseline, ScheduleBaselineActivity, ScheduleBaselineRelationship
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_subproject import ScheduleSubproject
from app.models.schedule_variant import ScheduleVariant
from app.schemas.activity import is_milestone_type
from app.schemas.schedule_baseline import (
    MilestoneTrendPoint,
    MilestoneTrendResponse,
    MilestoneTrendSeries,
    PromoteBaselineCreate,
    ScheduleBaselineCreate,
    ScheduleBaselineFromVariantCreate,
)
from app.schemas.schedule_variant import ScheduleVariantResponse
from app.services import scheduling_cpm
from app.services.activity import _attach_evm_fields, _require_live_schedule_period
from app.services.project import _clone_row


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
    """Snapshots every activity's current start/finish/duration_hours, *and*
    every relationship between them (2026-07-07, per Maro —
    docs/SCHEDULING_GAPS_PLAN.md Phase 6: a baseline should capture a full
    schedule, not just dates, so it can genuinely be opened as an
    independent working copy later — see promote_baseline_to_variant below),
    under a new named, dated baseline. Deliberately does NOT assign it — per
    Maro, "set a baseline" (capture) and "assign a baseline" (apply) are two
    separate, deliberate actions, not one combined step. See
    assign_baseline below for the apply half."""
    period = await db.get(SchedulePeriod, data.schedule_period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Schedule period not found")
    await _require_live_schedule_period(db, data.schedule_period_id)

    baseline = ScheduleBaseline(
        schedule_period_id=data.schedule_period_id, name=data.name, baseline_date=data.baseline_date
    )
    db.add(baseline)
    await db.flush()

    result = await db.execute(select(Activity).where(Activity.schedule_period_id == data.schedule_period_id))
    activities = list(result.scalars().all())
    for a in activities:
        db.add(ScheduleBaselineActivity(
            baseline_id=baseline.id, activity_id=a.id, code=a.code,
            start=a.start, finish=a.finish, duration_hours=a.duration_hours,
        ))

    activity_ids = {a.id for a in activities}
    if activity_ids:
        rel_result = await db.execute(
            select(ActivityRelationship).where(
                ActivityRelationship.predecessor_id.in_(activity_ids),
                ActivityRelationship.successor_id.in_(activity_ids),
            )
        )
        for r in rel_result.scalars().all():
            db.add(ScheduleBaselineRelationship(
                baseline_id=baseline.id, predecessor_id=r.predecessor_id, successor_id=r.successor_id,
                relationship_type=r.relationship_type, lag_hours=r.lag_hours,
            ))

    await db.commit()
    await db.refresh(baseline)
    baseline.activity_count = len(activities)
    return baseline


async def create_baseline_from_variant(db: AsyncSession, data: ScheduleBaselineFromVariantCreate) -> ScheduleBaseline:
    """Cross-variant baselining (docs/SCHEDULE_VARIANTS_PLAN.md §D.7) — Maro:
    "the ability to use the second programme and assign the original
    schedule as a baseline is important and vice versa." Unlike
    create_baseline above (which snapshots the target period's *own* current
    state), this populates the baseline from a *different* schedule variant's
    current live activities, matched to the target's own activities by code
    — the same "same activity, more mature in one variant than another"
    matching promote_variant already relies on (app/services/
    schedule_variant.py). An activity with no code match on the source side
    is simply skipped, not fabricated — same "no snapshot = no reference
    point" rule create_baseline's own later assign/clear paths already use
    for activities created after a capture.

    The baseline itself still belongs to the *target* schedule period (it's
    "a baseline of the new master," not of the source variant) — only the
    values populating it come from elsewhere.
    """
    target_period = await db.get(SchedulePeriod, data.schedule_period_id)
    if target_period is None:
        raise HTTPException(status_code=404, detail="Schedule period not found")
    await _require_live_schedule_period(db, data.schedule_period_id)

    target_variant = await db.get(ScheduleVariant, target_period.schedule_variant_id)
    source_variant = await db.get(ScheduleVariant, data.source_schedule_variant_id)
    if source_variant is None:
        raise HTTPException(status_code=404, detail="Source schedule variant not found")
    if target_variant is None or source_variant.project_id != target_variant.project_id:
        raise HTTPException(status_code=404, detail="Source schedule variant not found in this project")

    source_period_result = await db.execute(
        select(SchedulePeriod).where(
            SchedulePeriod.schedule_variant_id == data.source_schedule_variant_id,
            SchedulePeriod.freeze_status == "live",
        )
    )
    source_period = source_period_result.scalar_one_or_none()
    if source_period is None:
        raise HTTPException(status_code=404, detail="Source schedule variant has no live schedule period")

    target_activities = (await db.execute(
        select(Activity).where(Activity.schedule_period_id == data.schedule_period_id)
    )).scalars().all()
    source_activities = (await db.execute(
        select(Activity).where(Activity.schedule_period_id == source_period.id)
    )).scalars().all()
    source_by_code = {a.code: a for a in source_activities}

    baseline = ScheduleBaseline(
        schedule_period_id=data.schedule_period_id, name=data.name, baseline_date=data.baseline_date
    )
    db.add(baseline)
    await db.flush()

    matched = 0
    target_by_code = {a.code: a for a in target_activities}
    for target_activity in target_activities:
        source_activity = source_by_code.get(target_activity.code)
        if source_activity is None:
            continue
        db.add(ScheduleBaselineActivity(
            baseline_id=baseline.id, activity_id=target_activity.id, code=target_activity.code,
            start=source_activity.start, finish=source_activity.finish,
            duration_hours=source_activity.duration_hours,
        ))
        matched += 1

    # Relationships too (2026-07-07, per Maro — same "capture a full
    # schedule" reasoning as create_baseline above), sourced from the
    # *source* variant's own logic and remapped onto the target's matching
    # activities by code — a link where either end has no code match on the
    # target side is simply skipped, same "no match = no reference point"
    # rule the activity snapshot above already follows.
    source_activity_ids = {a.id for a in source_activities}
    if source_activity_ids:
        rel_result = await db.execute(
            select(ActivityRelationship).where(
                ActivityRelationship.predecessor_id.in_(source_activity_ids),
                ActivityRelationship.successor_id.in_(source_activity_ids),
            )
        )
        source_by_id = {a.id: a for a in source_activities}
        for r in rel_result.scalars().all():
            pred_target = target_by_code.get(source_by_id[r.predecessor_id].code)
            succ_target = target_by_code.get(source_by_id[r.successor_id].code)
            if pred_target is None or succ_target is None:
                continue
            db.add(ScheduleBaselineRelationship(
                baseline_id=baseline.id, predecessor_id=pred_target.id, successor_id=succ_target.id,
                relationship_type=r.relationship_type, lag_hours=r.lag_hours,
            ))

    await db.commit()
    await db.refresh(baseline)
    baseline.activity_count = matched
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


async def list_baselines(db: AsyncSession, schedule_period_id: uuid.UUID) -> list[ScheduleBaseline]:
    result = await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.schedule_period_id == schedule_period_id)
        .order_by(ScheduleBaseline.baseline_date.desc(), ScheduleBaseline.created_at.desc())
    )
    baselines = list(result.scalars().all())
    await _attach_activity_counts(db, baselines)
    return baselines


async def get_milestone_trend(db: AsyncSession, schedule_period_id: uuid.UUID) -> MilestoneTrendResponse:
    """Milestone Trend Analysis (2026-09-03, per Maro: "charts across baseline
    periods... whether milestones have improved or delayed over time") — for
    every live milestone, its own forecast finish at each saved baseline
    (chronological), plus a final "Current" point from its live, un-baselined
    finish. Matched by activity_id (ScheduleBaselineActivity's own stable
    reference — see that model's own docstring), never by code/name, since a
    milestone's code can change between baselines (promoted/demoted/renamed)
    but its activity_id never does. A milestone missing a snapshot row for a
    given baseline (created after that baseline was captured) simply has no
    point for it, rather than a fabricated/interpolated one."""
    milestones_result = await db.execute(
        select(Activity).where(
            Activity.schedule_period_id == schedule_period_id,
            Activity.is_archived.is_(False),
        ).order_by(Activity.wbs_path)
    )
    milestones = [a for a in milestones_result.scalars().all() if is_milestone_type(a.activity_type)]
    if not milestones:
        return MilestoneTrendResponse(series=[])

    baselines_result = await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.schedule_period_id == schedule_period_id)
        .order_by(ScheduleBaseline.baseline_date.asc(), ScheduleBaseline.created_at.asc())
    )
    baselines = list(baselines_result.scalars().all())

    snapshots_by_baseline_and_activity: dict[tuple[uuid.UUID, uuid.UUID], ScheduleBaselineActivity] = {}
    if baselines:
        milestone_ids = [m.id for m in milestones]
        baseline_ids = [b.id for b in baselines]
        snap_result = await db.execute(
            select(ScheduleBaselineActivity).where(
                ScheduleBaselineActivity.baseline_id.in_(baseline_ids),
                ScheduleBaselineActivity.activity_id.in_(milestone_ids),
            )
        )
        snapshots_by_baseline_and_activity = {
            (s.baseline_id, s.activity_id): s for s in snap_result.scalars().all()
        }

    series = []
    for m in milestones:
        points = [
            MilestoneTrendPoint(baseline_id=b.id, baseline_name=b.name, baseline_date=b.baseline_date, finish=snap.finish)
            for b in baselines
            if (snap := snapshots_by_baseline_and_activity.get((b.id, m.id))) is not None
        ]
        points.append(MilestoneTrendPoint(baseline_id=None, baseline_name="Current", baseline_date=date.today(), finish=m.finish))
        series.append(MilestoneTrendSeries(activity_id=m.id, code=m.code, task_name=m.task_name, points=points))
    return MilestoneTrendResponse(series=series)


async def _clear_baseline_fields(db: AsyncSession, schedule_period_id: uuid.UUID) -> list[Activity]:
    """Nulls bl_start/bl_finish/bl_duration_hours/variance_days on every
    activity in a schedule period — used whenever the period's active
    baseline goes away (deleted or unassigned) and those figures have no
    reference point left to reflect.

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
    act_result = await db.execute(select(Activity).where(Activity.schedule_period_id == schedule_period_id))
    activities = list(act_result.scalars().all())
    for a in activities:
        a.bl_start = None
        a.bl_finish = None
        a.bl_duration_hours = None
        a.variance_days = None
    # Refresh only the rows actually changed by this pass — captured *before*
    # flush, since flushing clears SQLAlchemy's dirty-tracking (an activity
    # whose bl_* fields were already null isn't touched by the assignment
    # above). Same fix as activity.py's own _recompute_hierarchy/
    # scheduling_cpm.py's recompute_schedule, which independently measured
    # "refresh every activity in the period regardless of whether it
    # changed" as a real, one-extra-round-trip-per-activity performance bug.
    dirty_ids = {a.id for a in activities if db.is_modified(a)}
    await db.flush()
    for a in activities:
        if a.id in dirty_ids:
            await db.refresh(a)
    return activities


async def assign_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> list[Activity]:
    """Copies a saved baseline's snapshot into bl_start/bl_finish/
    bl_duration_hours on every activity in its schedule period — the same
    effect the old one-shot "Set Baseline" action had, just sourced from a
    chosen saved capture instead of "right now". Activities created after
    the baseline was captured (no snapshot row) get their bl_* fields
    cleared to null rather than left stale from whatever was previously
    assigned — they genuinely have no reference point in this baseline.

    Also flips is_active: only one baseline per schedule period is ever
    active at a time, so every other baseline in the same period gets
    is_active=False first."""
    baseline = await db.get(ScheduleBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_schedule_period(db, baseline.schedule_period_id)

    siblings_result = await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.schedule_period_id == baseline.schedule_period_id)
    )
    for sibling in siblings_result.scalars().all():
        sibling.is_active = sibling.id == baseline.id

    snap_result = await db.execute(
        select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id == baseline_id)
    )
    snapshots = {s.activity_id: s for s in snap_result.scalars().all()}

    act_result = await db.execute(select(Activity).where(Activity.schedule_period_id == baseline.schedule_period_id))
    activities = list(act_result.scalars().all())
    for a in activities:
        snap = snapshots.get(a.id)
        a.bl_start = snap.start if snap else None
        a.bl_finish = snap.finish if snap else None
        a.bl_duration_hours = snap.duration_hours if snap else None
        a.variance_days = (
            (a.finish - a.bl_finish).days if a.finish is not None and a.bl_finish is not None else None
        )

    # Same dirty-subset-only refresh as _clear_baseline_fields above — an
    # activity with no snapshot AND no previously-assigned bl_* fields
    # isn't actually touched by the loop above (still None -> None).
    dirty_ids = {a.id for a in activities if db.is_modified(a)}
    await db.commit()
    for a in activities:
        if a.id in dirty_ids:
            await db.refresh(a)
    await _attach_evm_fields(db, activities)
    return activities


async def delete_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> None:
    baseline = await db.get(ScheduleBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_schedule_period(db, baseline.schedule_period_id)

    if baseline.is_active:
        # Every activity's bl_start/bl_finish/bl_duration_hours/variance_days
        # currently holds *this* baseline's snapshot (assign_baseline copied
        # it in) — with the baseline gone, those figures have no reference
        # point left and must clear, the same "no snapshot = null, not stale"
        # rule assign_baseline already applies to activities created after a
        # capture. Previously left untouched, which meant BL Start/BL Finish
        # and Fin. Var (d) kept showing a deleted baseline's numbers
        # indefinitely, in both the table and the Gantt.
        await _clear_baseline_fields(db, baseline.schedule_period_id)

    # ScheduleBaselineActivity rows cascade via the FK's ON DELETE CASCADE. If
    # this was the active one, there's simply no baseline with is_active=True
    # for this schedule period anymore — no cross-table pointer to clean up,
    # since is_active lives on this table, not a SchedulePeriod back-reference.
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
    await _require_live_schedule_period(db, baseline.schedule_period_id)
    if not baseline.is_active:
        raise HTTPException(status_code=422, detail="This baseline isn't currently assigned")

    baseline.is_active = False
    activities = await _clear_baseline_fields(db, baseline.schedule_period_id)  # already flushed + refreshed

    await db.commit()
    await _attach_evm_fields(db, activities)
    return activities


async def promote_baseline_to_variant(
    db: AsyncSession, baseline_id: uuid.UUID, data: PromoteBaselineCreate
) -> tuple[ScheduleVariant, bool]:
    """"Open a baseline as a working schedule" (2026-07-07, per Maro —
    docs/SCHEDULING_GAPS_PLAN.md Phase 6): forks a brand new ScheduleVariant
    seeded from this baseline's own captured snapshot, editable and
    independent from here on — not a read-only comparison the way
    bl_start/bl_finish variance already is. Reuses the exact clone/id-remap
    technique app/services/schedule_variant.py:duplicate_schedule_variant
    already established, just sourced from a baseline snapshot instead of a
    live variant's current state.

    Only activities the snapshot actually covers are cloned — a baseline's
    ScheduleBaselineActivity rows are keyed to *this period's* activity ids
    (both create_baseline and create_baseline_from_variant snapshot onto the
    target period's own activities, never the source's), so those ids are
    used directly to pull each activity's current structural fields
    (task_name, activity_type, constraint_type, calendar_id, etc.) as the
    clone template, with only code/start/finish/duration_hours overridden
    from the snapshot itself — an activity created after the baseline was
    captured has no snapshot row and is simply not part of the promoted
    schedule, same "no snapshot = no reference point" rule assign_baseline
    already applies.

    Relationships come from ScheduleBaselineRelationship if this baseline has
    any (captured schedules from 2026-07-07 onward); older baselines have no
    rows there, so this falls back to the *current live* relationships among
    the matched activities instead — surfaced via the returned bool rather
    than silently presenting a partial reconstruction as a true historical
    restore.

    start/finish are never copied in directly onto the clones (same as
    everywhere else in this app — they're always CPM-computed, never
    accepted as input): duration_hours/constraint_type/constraint_date and
    the cloned relationships are the real inputs, and
    scheduling_cpm.recompute_schedule derives start/finish from them at the
    end, same as any other live schedule."""
    baseline = await db.get(ScheduleBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")

    source_period = await db.get(SchedulePeriod, baseline.schedule_period_id)
    if source_period is None:
        raise HTTPException(status_code=404, detail="Schedule period not found")
    source_variant = await db.get(ScheduleVariant, source_period.schedule_variant_id)
    if source_variant is None:
        raise HTTPException(status_code=404, detail="Schedule variant not found")

    snapshots = (await db.execute(
        select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id == baseline_id)
    )).scalars().all()
    snapshot_by_activity_id = {s.activity_id: s for s in snapshots}

    new_variant = ScheduleVariant(
        project_id=source_variant.project_id, name=data.name, variant_type=data.variant_type, is_master=False,
    )
    db.add(new_variant)
    await db.flush()

    new_period_id = uuid.uuid4()
    db.add(SchedulePeriod(id=new_period_id, schedule_variant_id=new_variant.id, period_label="Period 1", freeze_status="live"))

    if not snapshot_by_activity_id:
        await db.commit()
        await db.refresh(new_variant)
        return new_variant, True

    live_activities = (await db.execute(
        select(Activity).where(Activity.id.in_(snapshot_by_activity_id.keys()))
    )).scalars().all()

    activity_map = {a.id: uuid.uuid4() for a in live_activities}
    new_activities: dict[uuid.UUID, Activity] = {}
    for a in live_activities:
        snap = snapshot_by_activity_id[a.id]
        clone = _clone_row(
            a, activity_map[a.id],
            schedule_variant_id=new_variant.id, schedule_period_id=new_period_id, parent_id=None,
            code=snap.code, start=snap.start, finish=snap.finish, duration_hours=snap.duration_hours,
        )
        db.add(clone)
        new_activities[a.id] = clone
    await db.flush()
    for a in live_activities:
        if a.parent_id is not None and a.parent_id in activity_map:
            new_activities[a.id].parent_id = activity_map[a.parent_id]

    history = (await db.execute(
        select(ActivityCodeHistory).where(ActivityCodeHistory.activity_id.in_(activity_map.keys()))
    )).scalars().all()
    for h in history:
        db.add(_clone_row(h, uuid.uuid4(), activity_id=activity_map[h.activity_id]))

    assignments = (await db.execute(
        select(ResourceAssignment).where(ResourceAssignment.activity_id.in_(activity_map.keys()))
    )).scalars().all()
    for ra in assignments:
        db.add(_clone_row(ra, uuid.uuid4(), activity_id=activity_map[ra.activity_id]))

    subprojects = (await db.execute(
        select(ScheduleSubproject).where(ScheduleSubproject.root_wbs_id.in_(activity_map.keys()))
    )).scalars().all()
    for sp in subprojects:
        db.add(_clone_row(sp, uuid.uuid4(), root_wbs_id=activity_map[sp.root_wbs_id]))

    baseline_rels = (await db.execute(
        select(ScheduleBaselineRelationship).where(ScheduleBaselineRelationship.baseline_id == baseline_id)
    )).scalars().all()
    relationships_from_baseline_snapshot = bool(baseline_rels)
    if relationships_from_baseline_snapshot:
        for r in baseline_rels:
            pred_new = activity_map.get(r.predecessor_id)
            succ_new = activity_map.get(r.successor_id)
            if pred_new is None or succ_new is None:
                continue
            db.add(ActivityRelationship(
                predecessor_id=pred_new, successor_id=succ_new,
                relationship_type=r.relationship_type, lag_hours=r.lag_hours,
            ))
    else:
        live_rels = (await db.execute(
            select(ActivityRelationship).where(
                ActivityRelationship.predecessor_id.in_(activity_map.keys()),
                ActivityRelationship.successor_id.in_(activity_map.keys()),
            )
        )).scalars().all()
        for r in live_rels:
            db.add(_clone_row(
                r, uuid.uuid4(),
                predecessor_id=activity_map[r.predecessor_id], successor_id=activity_map[r.successor_id],
            ))

    await db.commit()
    await scheduling_cpm.recompute_schedule(db, new_period_id)
    await db.refresh(new_variant)
    return new_variant, relationships_from_baseline_snapshot
