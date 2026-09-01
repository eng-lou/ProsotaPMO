from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.collection_member import CollectionMember
from app.schemas.collection import (
    CollectionMemberBulkCreate,
    CollectionMemberBulkResponse,
    CollectionMemberCreate,
    CollectionMemberResponse,
)


async def add_member(db: AsyncSession, data: CollectionMemberCreate) -> CollectionMemberResponse:
    collection = await db.get(Collection, data.collection_id)
    if collection is None:
        raise HTTPException(status_code=404, detail="Collection not found")

    existing = (await db.execute(
        select(CollectionMember).where(
            CollectionMember.collection_id == data.collection_id,
            CollectionMember.source_kind == data.source_kind,
            CollectionMember.element_ref == data.element_ref,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This element is already in this collection")

    row = CollectionMember(
        collection_id=data.collection_id, source_kind=data.source_kind,
        element_ref=data.element_ref, element_label=data.element_label,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return CollectionMemberResponse.model_validate(row)


async def add_members_bulk(db: AsyncSession, data: CollectionMemberBulkCreate) -> CollectionMemberBulkResponse:
    """One request, one duplicate check, one INSERT...RETURNING, one commit
    (2026-09-01, per Maro: "adding selected elements to a collection...
    took too long") — replaces N sequential POST /collection-members/
    calls (FourD.tsx's own handleAddSelectedToCollection, and Poe's
    execute_clash_test_proposal bridge handler) with a single round trip.
    id is generated here (not left to the model's own Python-side
    `default=uuid.uuid4`) because bulk core-level INSERT..RETURNING (not
    the ORM unit-of-work `db.add()` path) needs every column value
    supplied explicitly up front, not populated lazily on flush the way a
    single `db.add()` + commit would. created_at/updated_at stay
    server_default — RETURNING pulls the real server-computed values back
    in the same statement, so this never approximates a timestamp
    client-side.
    """
    collection = await db.get(Collection, data.collection_id)
    if collection is None:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not data.members:
        return CollectionMemberBulkResponse(created=[], skipped_duplicates=0)

    existing = (await db.execute(
        select(CollectionMember.source_kind, CollectionMember.element_ref).where(
            CollectionMember.collection_id == data.collection_id,
        )
    )).all()
    existing_keys = {(sk, ref) for sk, ref in existing}

    # De-duped against both the collection's real existing members AND
    # within this same incoming batch — a caller resolving a live
    # selection shouldn't ever submit the same element twice, but nothing
    # structurally prevents it, so this stays defensive rather than
    # assumed-safe.
    seen_in_batch: set[tuple[str, str]] = set()
    to_insert: list[dict] = []
    skipped = 0
    for m in data.members:
        key = (m.source_kind, m.element_ref)
        if key in existing_keys or key in seen_in_batch:
            skipped += 1
            continue
        seen_in_batch.add(key)
        to_insert.append({
            "id": uuid.uuid4(), "collection_id": data.collection_id,
            "source_kind": m.source_kind, "element_ref": m.element_ref, "element_label": m.element_label,
        })

    if not to_insert:
        return CollectionMemberBulkResponse(created=[], skipped_duplicates=skipped)

    created = (await db.scalars(insert(CollectionMember).returning(CollectionMember), to_insert)).all()
    await db.commit()
    return CollectionMemberBulkResponse(
        created=[CollectionMemberResponse.model_validate(r) for r in created],
        skipped_duplicates=skipped,
    )


async def remove_member(db: AsyncSession, member_id: uuid.UUID) -> None:
    row = await db.get(CollectionMember, member_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Collection member not found")
    await db.delete(row)
    await db.commit()
