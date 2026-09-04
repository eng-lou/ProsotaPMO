from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_code_history import ActivityCodeHistory
from app.models.activity_relationship import ActivityRelationship
from app.models.cost_element import CostElement
from app.models.record_link import RecordLink
from app.models.resource_assignment import ResourceAssignment
from app.models.schedule_baseline import ScheduleBaseline, ScheduleBaselineActivity
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_subproject import ScheduleSubproject
from app.models.schedule_variant import ScheduleVariant
from app.schemas.schedule_variant import ScheduleVariantCreate, ScheduleVariantUpdate
from app.services import cost_sync
from app.services.project import _clone_row


async def list_variants(db: AsyncSession, project_id: uuid.UUID) -> list[ScheduleVariant]:
    result = await db.execute(
        select(ScheduleVariant).where(ScheduleVariant.project_id == project_id).order_by(ScheduleVariant.created_at)
    )
    return list(result.scalars().all())


async def get_variant(db: AsyncSession, variant_id: uuid.UUID) -> ScheduleVariant:
    variant = await db.get(ScheduleVariant, variant_id)
    if variant is None:
        raise HTTPException(status_code=404, detail="Schedule variant not found")
    return variant


# Same atomic find-or-create shape as app/services/schedule_period.py:bootstrap_period
# and the original app/api/periods.py:bootstrap_period — every project needs exactly
# one master ScheduleVariant, lazily created the first time anything asks for it
# rather than at project-creation time (docs/SCHEDULE_VARIANTS_PLAN.md, private docs
# repo — existing projects get this backfilled by migration instead; new ones get it
# here, on first real use).
async def get_or_create_master(db: AsyncSession, project_id: uuid.UUID) -> ScheduleVariant:
    result = await db.execute(
        select(ScheduleVariant).where(ScheduleVariant.project_id == project_id, ScheduleVariant.is_master.is_(True))
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing

    variant = ScheduleVariant(project_id=project_id, name="Working Schedule", is_master=True)
    db.add(variant)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        result = await db.execute(
            select(ScheduleVariant).where(ScheduleVariant.project_id == project_id, ScheduleVariant.is_master.is_(True))
        )
        return result.scalar_one()
    await db.refresh(variant)
    return variant


async def create_variant(db: AsyncSession, data: ScheduleVariantCreate) -> ScheduleVariant:
    if data.duplicate_from_variant_id is not None:
        return await duplicate_schedule_variant(db, data.duplicate_from_variant_id, data.name, data.variant_type)

    variant = ScheduleVariant(project_id=data.project_id, name=data.name, variant_type=data.variant_type, is_master=False)
    db.add(variant)
    await db.flush()
    # A blank variant gets one fresh live SchedulePeriod immediately, same as
    # the master's own lazy-seeded "Period 1" (schedule_period.py:
    # bootstrap_period) — a variant with nowhere to put its first activity
    # isn't actually usable yet, and there's no reason to make the caller
    # remember a separate bootstrap call for this one path.
    db.add(SchedulePeriod(schedule_variant_id=variant.id, period_label="Period 1", freeze_status="live"))
    await db.commit()
    await db.refresh(variant)
    return variant


async def update_variant(db: AsyncSession, variant_id: uuid.UUID, data: ScheduleVariantUpdate) -> ScheduleVariant:
    variant = await get_variant(db, variant_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(variant, field, value)
    await db.commit()
    await db.refresh(variant)
    return variant


async def delete_variant(db: AsyncSession, variant_id: uuid.UUID) -> None:
    variant = await get_variant(db, variant_id)
    if variant.is_master:
        # Matches the reserved Archive container's own "can't delete the thing
        # everything else depends on" rule — promote another variant first
        # (docs/SCHEDULE_VARIANTS_PLAN.md §E).
        raise HTTPException(
            status_code=422,
            detail="The master schedule can't be deleted directly — create or duplicate another schedule "
                   "and promote it to master first.",
        )
    await db.delete(variant)
    await db.commit()


async def duplicate_schedule_variant(
    db: AsyncSession, source_variant_id: uuid.UUID, new_name: str, new_variant_type: str | None = None
) -> ScheduleVariant:
    """Forks a variant's *current live* schedule only — not its frozen period
    history, not Risk/Cost/ICD (project-wide, untouched), not saved Quality
    runs (historical to the source schedule specifically, deliberately not
    carried into a schedule that's about to diverge from it) —
    docs/SCHEDULE_VARIANTS_PLAN.md §D.4. Reuses the exact clone/id-remapping
    technique already proven in duplicate_project, scoped down to
    schedule-only tables."""
    source = await get_variant(db, source_variant_id)

    new_variant = ScheduleVariant(
        project_id=source.project_id, name=new_name, variant_type=new_variant_type, is_master=False,
    )
    db.add(new_variant)
    await db.flush()

    periods = (await db.execute(
        select(SchedulePeriod).where(SchedulePeriod.schedule_variant_id == source_variant_id)
    )).scalars().all()
    live_period = next((p for p in periods if p.freeze_status == "live"), None)
    if live_period is None:
        await db.commit()
        await db.refresh(new_variant)
        return new_variant

    new_period_id = uuid.uuid4()
    db.add(_clone_row(live_period, new_period_id, schedule_variant_id=new_variant.id))

    activities = (await db.execute(
        select(Activity).where(Activity.schedule_period_id == live_period.id)
    )).scalars().all()
    activity_map = {a.id: uuid.uuid4() for a in activities}
    new_activities: dict[uuid.UUID, Activity] = {}
    for a in activities:
        clone = _clone_row(
            a, activity_map[a.id],
            schedule_variant_id=new_variant.id, schedule_period_id=new_period_id, parent_id=None,
        )
        db.add(clone)
        new_activities[a.id] = clone
    if activities:
        await db.flush()
    for a in activities:
        if a.parent_id is not None:
            new_activities[a.id].parent_id = activity_map[a.parent_id]

    if activity_map:
        history = (await db.execute(
            select(ActivityCodeHistory).where(ActivityCodeHistory.activity_id.in_(activity_map.keys()))
        )).scalars().all()
        for h in history:
            db.add(_clone_row(h, uuid.uuid4(), activity_id=activity_map[h.activity_id]))

        relationships = (await db.execute(
            select(ActivityRelationship).where(ActivityRelationship.predecessor_id.in_(activity_map.keys()))
        )).scalars().all()
        for r in relationships:
            db.add(_clone_row(
                r, uuid.uuid4(),
                predecessor_id=activity_map[r.predecessor_id], successor_id=activity_map[r.successor_id],
            ))

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

    baselines = (await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.schedule_period_id == live_period.id)
    )).scalars().all()
    baseline_map = {b.id: uuid.uuid4() for b in baselines}
    for b in baselines:
        db.add(_clone_row(b, baseline_map[b.id], schedule_period_id=new_period_id))
    if baseline_map:
        baseline_activities = (await db.execute(
            select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id.in_(baseline_map.keys()))
        )).scalars().all()
        for ba in baseline_activities:
            db.add(_clone_row(
                ba, uuid.uuid4(),
                baseline_id=baseline_map[ba.baseline_id], activity_id=activity_map[ba.activity_id],
            ))

    await db.commit()
    await db.refresh(new_variant)
    return new_variant


async def promote_variant(db: AsyncSession, variant_id: uuid.UUID) -> tuple[ScheduleVariant, list[str]]:
    """Flips which variant is master and re-links anything that pointed at the
    old master's activities onto the new master's — matched by activity
    *code*, not row id, since that's what "the same activity, more mature in
    one schedule than another" actually means (docs/SCHEDULE_VARIANTS_PLAN.md
    §D.5/§D.6). Risk/CostElement/IcdItem's own period reporting is completely
    untouched — they were never coupled to schedule variants in the first
    place, which is the entire point of the split.

    Returns (new_master, unmatched_codes) — codes that existed on the old
    master but have no match on the new one. `CostElement.linked_activity_id`
    falls back to SET NULL (it's a nullable FK); `RecordLink` has no nullable
    end to fall back to, so an unmatched link is deleted outright rather than
    left pointing at an activity from a different schedule. Either way it's
    surfaced in the return value, not silently dropped.
    """
    new_master = await get_variant(db, variant_id)
    if new_master.is_master:
        return new_master, []

    old_master_result = await db.execute(
        select(ScheduleVariant).where(
            ScheduleVariant.project_id == new_master.project_id, ScheduleVariant.is_master.is_(True)
        )
    )
    old_master = old_master_result.scalar_one_or_none()

    unmatched_codes: list[str] = []
    if old_master is not None:
        new_activities = (await db.execute(
            select(Activity).where(Activity.schedule_variant_id == new_master.id)
        )).scalars().all()
        new_id_by_code = {a.code: a.id for a in new_activities}

        old_activities = (await db.execute(
            select(Activity).where(Activity.schedule_variant_id == old_master.id)
        )).scalars().all()
        old_code_by_id = {a.id: a.code for a in old_activities}
        old_ids = set(old_code_by_id.keys())

        if old_ids:
            cost_elements = (await db.execute(
                select(CostElement).where(CostElement.linked_activity_id.in_(old_ids))
            )).scalars().all()
            for ce in cost_elements:
                code = old_code_by_id[ce.linked_activity_id]
                new_id = new_id_by_code.get(code)
                if new_id is not None:
                    ce.linked_activity_id = new_id
                else:
                    ce.linked_activity_id = None
                    unmatched_codes.append(code)

            links = (await db.execute(
                select(RecordLink).where(or_(
                    and_(RecordLink.source_type == "activity", RecordLink.source_id.in_(old_ids)),
                    and_(RecordLink.target_type == "activity", RecordLink.target_id.in_(old_ids)),
                ))
            )).scalars().all()
            for link in links:
                dropped = False
                if link.source_type == "activity" and link.source_id in old_ids:
                    code = old_code_by_id[link.source_id]
                    new_id = new_id_by_code.get(code)
                    if new_id is not None:
                        link.source_id = new_id
                    else:
                        unmatched_codes.append(code)
                        await db.delete(link)
                        dropped = True
                if not dropped and link.target_type == "activity" and link.target_id in old_ids:
                    code = old_code_by_id[link.target_id]
                    new_id = new_id_by_code.get(code)
                    if new_id is not None:
                        link.target_id = new_id
                    else:
                        unmatched_codes.append(code)
                        await db.delete(link)

        old_master.is_master = False
        # Flushed before flipping the new master on: the partial unique index
        # (`uq_schedule_variants_project_master`, at most one is_master=True
        # per project) isn't deferrable, and SQLAlchemy's flush ordering for
        # two independent UPDATEs on unrelated rows isn't guaranteed to match
        # the order they were assigned in Python — sending both in one batch
        # risks a transient "two masters at once" state that Postgres rejects
        # outright, regardless of which row's UPDATE the batch lists first.
        await db.flush()

    new_master.is_master = True
    await db.commit()
    await db.refresh(new_master)

    # sync_cost_element_from_resources's own is_master gate (see
    # cost_sync.py) means a variant's resource assignments never create
    # real Cost Plan lines while it's still non-master — deliberate, so a
    # reviewable schedule (a P6 import, a what-if variant) never budgets
    # against work that might get discarded. But nothing ever went back and
    # created those elements once a variant actually *becomes* master
    # (2026-09-04, found while wiring the PV/EV/AC trend chart up against a
    # real P6 import: promoted, 462 resource assignments, 0 cost elements —
    # only a prior master's *existing* elements get re-linked above, never
    # a brand-new master's own never-synced ones). Runs for every resource-
    # assigned activity, not just newly-linked ones — idempotent either way
    # (element exists and correct -> no-op write), and simpler than trying
    # to work out which ones are actually new.
    assigned_activity_ids = (await db.execute(
        select(ResourceAssignment.activity_id).join(Activity, ResourceAssignment.activity_id == Activity.id)
        .where(Activity.schedule_variant_id == new_master.id).distinct()
    )).scalars().all()
    for activity_id in assigned_activity_ids:
        await cost_sync.sync_cost_element_from_resources(db, activity_id, commit=False)
    if assigned_activity_ids:
        await db.commit()
    return new_master, unmatched_codes
