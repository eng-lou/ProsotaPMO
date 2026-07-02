from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.schemas.activity_relationship import ActivityRelationshipCreate, ActivityRelationshipUpdate
from app.services.activity import _require_live_period


async def _get_activity_in_period(db: AsyncSession, activity_id: uuid.UUID) -> Activity:
    activity = await db.get(Activity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


async def list_relationships(db: AsyncSession, period_id: uuid.UUID) -> list[ActivityRelationship]:
    # Both ends of a link always share a period (enforced at create) so joining via
    # either predecessor or successor's period_id is equivalent — predecessor is used.
    result = await db.execute(
        select(ActivityRelationship)
        .join(Activity, Activity.id == ActivityRelationship.predecessor_id)
        .where(Activity.period_id == period_id)
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
    if predecessor.period_id != successor.period_id:
        raise HTTPException(status_code=422, detail="Predecessor and successor must be in the same period")
    await _require_live_period(db, predecessor.period_id)

    # Exact duplicate pair (same ordered predecessor/successor) is also a DB-level
    # unique constraint (uq_activity_relationship_pair) — checked explicitly first so
    # it surfaces as a clean 422, not an unhandled IntegrityError.
    existing = await db.execute(
        select(ActivityRelationship).where(
            ActivityRelationship.predecessor_id == data.predecessor_id,
            ActivityRelationship.successor_id == data.successor_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=422,
            detail="A relationship already exists between these two activities",
        )

    # Full multi-hop cycle detection runs as part of Phase 5's CPM pass (it needs a
    # cycle-free graph to terminate anyway); here we only reject the direct reverse of
    # an existing link, per docs/SCHEDULING_MODULE_PLAN.md Phase 3.
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

    rel = ActivityRelationship(**data.model_dump())
    db.add(rel)
    await db.commit()
    await db.refresh(rel)
    return rel


async def update_relationship(
    db: AsyncSession, relationship_id: uuid.UUID, data: ActivityRelationshipUpdate
) -> ActivityRelationship:
    rel = await get_relationship(db, relationship_id)
    predecessor = await _get_activity_in_period(db, rel.predecessor_id)
    await _require_live_period(db, predecessor.period_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(rel, field, value)
    await db.commit()
    await db.refresh(rel)
    return rel


async def delete_relationship(db: AsyncSession, relationship_id: uuid.UUID) -> None:
    rel = await get_relationship(db, relationship_id)
    predecessor = await _get_activity_in_period(db, rel.predecessor_id)
    await _require_live_period(db, predecessor.period_id)
    await db.delete(rel)
    await db.commit()
