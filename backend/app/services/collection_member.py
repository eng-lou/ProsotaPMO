from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.collection_member import CollectionMember
from app.schemas.collection import CollectionMemberCreate, CollectionMemberResponse


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


async def remove_member(db: AsyncSession, member_id: uuid.UUID) -> None:
    row = await db.get(CollectionMember, member_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Collection member not found")
    await db.delete(row)
    await db.commit()
