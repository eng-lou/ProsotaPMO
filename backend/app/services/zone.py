from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.zone import Zone
from app.schemas.zone import ZoneCreate, ZoneResponse, ZoneUpdate


async def list_zones(db: AsyncSession, project_id: uuid.UUID) -> list[ZoneResponse]:
    rows = (await db.execute(
        select(Zone).where(Zone.project_id == project_id).order_by(Zone.created_at)
    )).scalars().all()
    return [ZoneResponse.model_validate(r) for r in rows]


async def create_zone(db: AsyncSession, data: ZoneCreate) -> ZoneResponse:
    # model_dump() already recursively turns each ZonePoint into a plain
    # {x,y,z} dict — exactly the shape the JSONB `points` column expects.
    row = Zone(**data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ZoneResponse.model_validate(row)


async def update_zone(db: AsyncSession, zone_id: uuid.UUID, data: ZoneUpdate) -> ZoneResponse:
    row = await db.get(Zone, zone_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return ZoneResponse.model_validate(row)


async def delete_zone(db: AsyncSession, zone_id: uuid.UUID) -> None:
    row = await db.get(Zone, zone_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    await db.delete(row)
    await db.commit()
