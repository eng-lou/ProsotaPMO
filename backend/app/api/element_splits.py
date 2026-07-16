from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.element_split import ElementSplitCreate, ElementSplitResponse, ElementSplitUpdate
from app.services import element_split as svc

router = APIRouter(prefix="/element-splits", tags=["element-splits"])


@router.get("/", response_model=list[ElementSplitResponse])
async def list_splits(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_splits(db, project_id)


@router.post("/", response_model=ElementSplitResponse, status_code=201)
async def create_split(
    data: ElementSplitCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_split(db, data)


@router.patch("/{split_id}", response_model=ElementSplitResponse)
async def update_split(
    split_id: uuid.UUID,
    data: ElementSplitUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_split(db, split_id, data)


@router.delete("/{split_id}", status_code=204)
async def delete_split(
    split_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_split(db, split_id)
    return Response(status_code=204)
