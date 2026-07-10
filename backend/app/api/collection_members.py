from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.collection import CollectionMemberCreate, CollectionMemberResponse
from app.services import collection_member as svc

router = APIRouter(prefix="/collection-members", tags=["collection-members"])


@router.post("/", response_model=CollectionMemberResponse, status_code=201)
async def add_collection_member(
    data: CollectionMemberCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.add_member(db, data)


@router.delete("/{member_id}", status_code=204)
async def remove_collection_member(
    member_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.remove_member(db, member_id)
    return Response(status_code=204)
