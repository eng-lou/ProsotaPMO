from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.zone import ZoneCreate, ZoneResponse, ZoneUpdate
from app.services import zone as svc

router = APIRouter(prefix="/zones", tags=["zones"])


@router.get("/", response_model=list[ZoneResponse])
async def list_zones(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_zones(db, project_id)


@router.post("/", response_model=ZoneResponse, status_code=201)
async def create_zone(
    data: ZoneCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_zone(db, data)


@router.patch("/{zone_id}", response_model=ZoneResponse)
async def update_zone(
    zone_id: uuid.UUID,
    data: ZoneUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_zone(db, zone_id, data)


@router.delete("/{zone_id}", status_code=204)
async def delete_zone(
    zone_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_zone(db, zone_id)
    return Response(status_code=204)
