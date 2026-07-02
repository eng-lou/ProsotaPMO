from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.activity_relationship import (
    ActivityRelationshipCreate,
    ActivityRelationshipResponse,
    ActivityRelationshipUpdate,
)
from app.services import activity_relationship as svc

router = APIRouter(prefix="/activity-relationships", tags=["activity-relationships"])


@router.get("/", response_model=list[ActivityRelationshipResponse])
async def list_relationships(
    period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_relationships(db, period_id)


@router.post("/", response_model=ActivityRelationshipResponse, status_code=201)
async def create_relationship(
    data: ActivityRelationshipCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_relationship(db, data)


@router.patch("/{relationship_id}", response_model=ActivityRelationshipResponse)
async def update_relationship(
    relationship_id: uuid.UUID,
    data: ActivityRelationshipUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_relationship(db, relationship_id, data)


@router.delete("/{relationship_id}", status_code=204)
async def delete_relationship(
    relationship_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_relationship(db, relationship_id)
    return Response(status_code=204)
