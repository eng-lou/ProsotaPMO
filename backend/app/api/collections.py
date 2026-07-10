from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.collection import CollectionCreate, CollectionResponse, CollectionUpdate
from app.services import collection as svc

router = APIRouter(prefix="/collections", tags=["collections"])


@router.get("/", response_model=list[CollectionResponse])
async def list_collections(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_collections(db, project_id)


@router.post("/", response_model=CollectionResponse, status_code=201)
async def create_collection(
    data: CollectionCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_collection(db, data)


@router.patch("/{collection_id}", response_model=CollectionResponse)
async def update_collection(
    collection_id: uuid.UUID,
    data: CollectionUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_collection(db, collection_id, data)


@router.delete("/{collection_id}", status_code=204)
async def delete_collection(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_collection(db, collection_id)
    return Response(status_code=204)
