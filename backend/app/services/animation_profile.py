from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.animation_profile import AnimationProfile
from app.schemas.animation_profile import AnimationProfileCreate, AnimationProfileResponse, AnimationProfileUpdate


async def list_profiles(db: AsyncSession, project_id: uuid.UUID) -> list[AnimationProfileResponse]:
    rows = (await db.execute(
        select(AnimationProfile).where(AnimationProfile.project_id == project_id).order_by(AnimationProfile.created_at)
    )).scalars().all()
    return [AnimationProfileResponse.model_validate(r) for r in rows]


async def create_profile(db: AsyncSession, data: AnimationProfileCreate) -> AnimationProfileResponse:
    row = AnimationProfile(project_id=data.project_id, name=data.name, config=data.config.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return AnimationProfileResponse.model_validate(row)


async def update_profile(db: AsyncSession, profile_id: uuid.UUID, data: AnimationProfileUpdate) -> AnimationProfileResponse:
    row = await db.get(AnimationProfile, profile_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Animation profile not found")
    row.name = data.name
    row.config = data.config.model_dump()
    await db.commit()
    await db.refresh(row)
    return AnimationProfileResponse.model_validate(row)


async def delete_profile(db: AsyncSession, profile_id: uuid.UUID) -> None:
    row = await db.get(AnimationProfile, profile_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Animation profile not found")
    await db.delete(row)
    await db.commit()
