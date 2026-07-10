from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.collection_member import CollectionMember
from app.schemas.collection import CollectionCreate, CollectionMemberResponse, CollectionResponse, CollectionUpdate


# Copied from app/services/activity.py's own _validate_no_cycle (WBS
# parent_id) rather than shared cross-module — every service in this
# codebase is self-contained, and Activity/Collection are unrelated
# domains that happen to need the identical walk-up-the-parent-chain check.
def _validate_no_cycle(
    by_id: dict[uuid.UUID, Collection], collection_id: uuid.UUID | None, new_parent_id: uuid.UUID
) -> None:
    cursor: uuid.UUID | None = new_parent_id
    seen: set[uuid.UUID] = set()
    while cursor is not None:
        if cursor == collection_id:
            raise HTTPException(status_code=422, detail="Cannot set parent: would create a cycle in the Collections tree")
        if cursor in seen:
            break  # already-inconsistent data — don't loop forever
        seen.add(cursor)
        parent = by_id.get(cursor)
        cursor = parent.parent_collection_id if parent else None


def _to_response(row: Collection, members: list[CollectionMember]) -> CollectionResponse:
    return CollectionResponse(
        id=row.id, project_id=row.project_id, name=row.name, parent_collection_id=row.parent_collection_id,
        sort_order=row.sort_order, created_at=row.created_at, updated_at=row.updated_at,
        members=[CollectionMemberResponse.model_validate(m) for m in members],
    )


async def _members_for(db: AsyncSession, collection_id: uuid.UUID) -> list[CollectionMember]:
    return list((await db.execute(
        select(CollectionMember).where(CollectionMember.collection_id == collection_id).order_by(CollectionMember.created_at)
    )).scalars().all())


async def list_collections(db: AsyncSession, project_id: uuid.UUID) -> list[CollectionResponse]:
    collections = list((await db.execute(
        select(Collection).where(Collection.project_id == project_id).order_by(Collection.sort_order, Collection.created_at)
    )).scalars().all())

    # One extra query for every collection's members, grouped in Python —
    # not N+1 — same two-query embedding shape used elsewhere in this
    # codebase for a parent with embedded children.
    members_by_collection: dict[uuid.UUID, list[CollectionMember]] = {c.id: [] for c in collections}
    if collections:
        member_rows = (await db.execute(
            select(CollectionMember)
            .where(CollectionMember.collection_id.in_([c.id for c in collections]))
            .order_by(CollectionMember.created_at)
        )).scalars().all()
        for m in member_rows:
            members_by_collection[m.collection_id].append(m)

    return [_to_response(c, members_by_collection[c.id]) for c in collections]


async def create_collection(db: AsyncSession, data: CollectionCreate) -> CollectionResponse:
    if data.parent_collection_id is not None:
        parent = await db.get(Collection, data.parent_collection_id)
        if parent is None:
            raise HTTPException(status_code=404, detail="Parent collection not found")
        siblings = (await db.execute(
            select(Collection).where(Collection.parent_collection_id == data.parent_collection_id)
        )).scalars().all()
    else:
        siblings = (await db.execute(
            select(Collection).where(Collection.project_id == data.project_id, Collection.parent_collection_id.is_(None))
        )).scalars().all()
    sort_order = (max((s.sort_order or 0) for s in siblings) + 1) if siblings else 0

    row = Collection(
        project_id=data.project_id, name=data.name, parent_collection_id=data.parent_collection_id, sort_order=sort_order,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_response(row, [])


async def update_collection(db: AsyncSession, collection_id: uuid.UUID, data: CollectionUpdate) -> CollectionResponse:
    row = await db.get(Collection, collection_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Collection not found")

    updates = data.model_dump(exclude_unset=True)
    if "parent_collection_id" in updates and updates["parent_collection_id"] is not None:
        result = await db.execute(select(Collection).where(Collection.project_id == row.project_id))
        by_id = {c.id: c for c in result.scalars().all()}
        _validate_no_cycle(by_id, collection_id, updates["parent_collection_id"])
        if updates["parent_collection_id"] not in by_id:
            raise HTTPException(status_code=404, detail="Parent collection not found in this project")

    for field, value in updates.items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return _to_response(row, await _members_for(db, collection_id))


async def delete_collection(db: AsyncSession, collection_id: uuid.UUID) -> None:
    row = await db.get(Collection, collection_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Collection not found")
    await db.delete(row)
    await db.commit()
