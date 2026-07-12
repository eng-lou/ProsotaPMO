from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.path_follower import PathFollower
from app.schemas.path_follower import PathFollowerCreate, PathFollowerResponse, PathFollowerUpdate


async def list_path_followers(db: AsyncSession, project_id: uuid.UUID) -> list[PathFollowerResponse]:
    rows = (await db.execute(
        select(PathFollower).where(PathFollower.project_id == project_id).order_by(PathFollower.created_at)
    )).scalars().all()
    return [PathFollowerResponse.model_validate(r) for r in rows]


# Upsert, not plain create (2026-07-11) — a target already bound to a path
# gets re-pointed by calling this again with a new path_id, matching how
# "drag a different curve onto the Follow Path constraint" behaves in
# Blender: it moves the existing binding, it doesn't add a second one that
# would fight the first every frame (see the model's own UniqueConstraint
# docstring). Catches the constraint violation from a genuine race (two
# near-simultaneous binds of the same target) rather than pre-checking with
# a SELECT first, which would still leave a race window between the check
# and the insert.
async def upsert_path_follower(db: AsyncSession, data: PathFollowerCreate) -> PathFollowerResponse:
    existing = (await db.execute(
        select(PathFollower).where(
            PathFollower.project_id == data.project_id,
            PathFollower.target_kind == data.target_kind,
            PathFollower.element_ref == data.element_ref,
        )
    )).scalar_one_or_none()
    if existing is not None:
        existing.path_id = data.path_id
        existing.orient_to_path = data.orient_to_path
        await db.commit()
        await db.refresh(existing)
        return PathFollowerResponse.model_validate(existing)

    row = PathFollower(**data.model_dump())
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This target is already bound to a path")
    await db.refresh(row)
    return PathFollowerResponse.model_validate(row)


async def update_path_follower(db: AsyncSession, follower_id: uuid.UUID, data: PathFollowerUpdate) -> PathFollowerResponse:
    row = await db.get(PathFollower, follower_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Path follower not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return PathFollowerResponse.model_validate(row)


async def delete_path_follower(db: AsyncSession, follower_id: uuid.UUID) -> None:
    row = await db.get(PathFollower, follower_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Path follower not found")
    await db.delete(row)
    await db.commit()
