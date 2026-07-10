from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.animation_profile import AnimationProfileCreate, AnimationProfileResponse, AnimationProfileUpdate
from app.services import animation_profile as svc

router = APIRouter(prefix="/animation-profiles", tags=["animation-profiles"])


@router.get("/", response_model=list[AnimationProfileResponse])
async def list_profiles(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_profiles(db, project_id)


@router.post("/", response_model=AnimationProfileResponse, status_code=201)
async def create_profile(
    data: AnimationProfileCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_profile(db, data)


@router.patch("/{profile_id}", response_model=AnimationProfileResponse)
async def update_profile(
    profile_id: uuid.UUID,
    data: AnimationProfileUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_profile(db, profile_id, data)


@router.delete("/{profile_id}", status_code=204)
async def delete_profile(
    profile_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_profile(db, profile_id)
    return Response(status_code=204)
