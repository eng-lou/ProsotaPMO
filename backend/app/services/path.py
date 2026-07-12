from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.path import Path
from app.schemas.path import PathCreate, PathResponse, PathUpdate


async def list_paths(db: AsyncSession, project_id: uuid.UUID) -> list[PathResponse]:
    rows = (await db.execute(
        select(Path).where(Path.project_id == project_id).order_by(Path.created_at)
    )).scalars().all()
    return [PathResponse.model_validate(r) for r in rows]


async def create_path(db: AsyncSession, data: PathCreate) -> PathResponse:
    # model_dump() already recursively turns each PathPoint into a plain
    # {x,y,z} dict — exactly the shape the JSONB `points` column expects.
    row = Path(**data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return PathResponse.model_validate(row)


async def update_path(db: AsyncSession, path_id: uuid.UUID, data: PathUpdate) -> PathResponse:
    row = await db.get(Path, path_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Path not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return PathResponse.model_validate(row)


async def delete_path(db: AsyncSession, path_id: uuid.UUID) -> None:
    row = await db.get(Path, path_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Path not found")
    await db.delete(row)
    await db.commit()
