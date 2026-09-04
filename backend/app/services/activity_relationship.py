from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.schemas.activity import valid_relationship_types_for_successor
from app.schemas.activity_relationship import ActivityRelationshipCreate, ActivityRelationshipUpdate
from app.services import scheduling_cpm
from app.services.activity import _recompute_hierarchy, _require_live_schedule_period


async def _get_activity_in_period(db: AsyncSession, activity_id: uuid.UUID) -> Activity:
    activity = await db.get(Activity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


def _validate_relationship_type_for_milestone(successor: Activity, relationship_type: str) -> None:
    # See app/schemas/activity.py:valid_relationship_types_for_successor for
    # the reasoning (only the relationship type's first letter — which
    # predecessor end is referenced — actually matters for a zero-duration
    # successor).
    valid = valid_relationship_types_for_successor(successor.activity_type)
    if valid is not None and relationship_type not in valid:
        kind = "Start Milestone" if successor.activity_type == "start_milestone" else "Finish Milestone"
        raise HTTPException(
            status_code=422,
            detail=f"'{successor.task_name}' is a {kind} — only {' or '.join(valid)} relationships can target it, "
                   f"since those are the only ones that drive its own meaningful date.",
        )


async def _recompute_period(db: AsyncSession, schedule_period_id: uuid.UUID) -> None:
    # CPM first (sets task/milestone dates from the now-changed logic), then the WBS
    # rollup (app/services/activity.py:_recompute_hierarchy) — summary rows roll up
    # from children's dates, so they'd go stale if rolled up before CPM runs.
    await scheduling_cpm.recompute_schedule(db, schedule_period_id)
    await _recompute_hierarchy(db, schedule_period_id)


async def list_relationships(db: AsyncSession, schedule_period_id: uuid.UUID) -> list[ActivityRelationship]:
    # Both ends of a link always share a schedule period (enforced at create) so
    # joining via either predecessor or successor's schedule_period_id is
    # equivalent — predecessor is used.
    result = await db.execute(
        select(ActivityRelationship)
        .join(Activity, Activity.id == ActivityRelationship.predecessor_id)
        .where(Activity.schedule_period_id == schedule_period_id)
    )
    return list(result.scalars().all())


async def get_relationship(db: AsyncSession, relationship_id: uuid.UUID) -> ActivityRelationship:
    rel = await db.get(ActivityRelationship, relationship_id)
    if rel is None:
        raise HTTPException(status_code=404, detail="Relationship not found")
    return rel


async def create_relationship(
    db: AsyncSession, data: ActivityRelationshipCreate
) -> ActivityRelationship:
    if data.predecessor_id == data.successor_id:
        raise HTTPException(status_code=422, detail="An activity cannot be its own predecessor")

    predecessor = await _get_activity_in_period(db, data.predecessor_id)
    successor = await _get_activity_in_period(db, data.successor_id)
    if predecessor.schedule_period_id != successor.schedule_period_id:
        raise HTTPException(status_code=422, detail="Predecessor and successor must be in the same schedule period")
    await _require_live_schedule_period(db, predecessor.schedule_period_id)

    # WBS/Project summary rows are rollups from their children (app/services/
    # activity.py:_recompute_hierarchy), not real CPM participants (see
    # scheduling_cpm.py:_cpm_participants) — a link to/from one would silently
    # do nothing, which is worse than rejecting it outright (2026-07-06, per
    # Maro: parents should have their sequencing computed from children, not
    # separately linkable, unless demoted to a plain task by removing them).
    for role, activity in (("predecessor", predecessor), ("successor", successor)):
        if activity.activity_type == "wbs_summary":
            raise HTTPException(
                status_code=422,
                detail=f"'{activity.task_name}' is a WBS/Project summary — its sequencing is derived from its "
                       f"children, so it can't be used as a {role}. Link its individual tasks/milestones instead.",
            )
    _validate_relationship_type_for_milestone(successor, data.relationship_type)

    # Exact duplicate (same ordered predecessor/successor AND same relationship
    # type) is also a DB-level unique constraint (uq_activity_relationship_pair)
    # — checked explicitly first so it surfaces as a clean 422, not an
    # unhandled IntegrityError. A second link of a *different* type between the
    # same pair is allowed (2026-09-04, per Maro — real P6 data can legitimately
    # constrain the same pair two ways at once, e.g. a Start-to-Start lag AND a
    # separate Finish-to-Start lag; the CPM engine already iterates every
    # relationship row for a pair, so this was purely an over-restrictive
    # schema rule, not an engine limitation).
    existing = await db.execute(
        select(ActivityRelationship).where(
            ActivityRelationship.predecessor_id == data.predecessor_id,
            ActivityRelationship.successor_id == data.successor_id,
            ActivityRelationship.relationship_type == data.relationship_type,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=422,
            detail=f"A {data.relationship_type} relationship already exists between these two activities",
        )

    # Direct reverse of an existing link (checked here, cheaply, before the general
    # multi-hop check) plus any longer cycle (A->B->C->A) — the latter is what Phase 5's
    # CPM engine needs a cycle-free graph for, per docs/SCHEDULING_MODULE_PLAN.md Phase 3.
    reverse = await db.execute(
        select(ActivityRelationship).where(
            ActivityRelationship.predecessor_id == data.successor_id,
            ActivityRelationship.successor_id == data.predecessor_id,
        )
    )
    if reverse.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=422,
            detail="The reverse relationship already exists between these two activities",
        )
    if await scheduling_cpm.would_create_cycle(
        db, predecessor.schedule_period_id, data.predecessor_id, data.successor_id
    ):
        raise HTTPException(status_code=422, detail="This relationship would create a circular dependency")

    rel = ActivityRelationship(**data.model_dump())
    db.add(rel)
    await db.commit()
    await db.refresh(rel)

    await _recompute_period(db, predecessor.schedule_period_id)
    return rel


async def update_relationship(
    db: AsyncSession, relationship_id: uuid.UUID, data: ActivityRelationshipUpdate
) -> ActivityRelationship:
    rel = await get_relationship(db, relationship_id)
    predecessor = await _get_activity_in_period(db, rel.predecessor_id)
    await _require_live_schedule_period(db, predecessor.schedule_period_id)
    updates = data.model_dump(exclude_unset=True)
    if "relationship_type" in updates and updates["relationship_type"] is not None:
        successor = await _get_activity_in_period(db, rel.successor_id)
        _validate_relationship_type_for_milestone(successor, updates["relationship_type"])
    for field, value in updates.items():
        setattr(rel, field, value)
    await db.commit()
    await db.refresh(rel)

    await _recompute_period(db, predecessor.schedule_period_id)
    return rel


async def delete_relationship(db: AsyncSession, relationship_id: uuid.UUID) -> None:
    rel = await get_relationship(db, relationship_id)
    predecessor = await _get_activity_in_period(db, rel.predecessor_id)
    await _require_live_schedule_period(db, predecessor.schedule_period_id)
    await db.delete(rel)
    await db.commit()

    await _recompute_period(db, predecessor.schedule_period_id)
