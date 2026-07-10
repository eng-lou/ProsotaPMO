from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.schedule_variant import (
    PromoteVariantResponse,
    ScheduleVariantCreate,
    ScheduleVariantResponse,
    ScheduleVariantUpdate,
)
from app.services import schedule_variant as svc

router = APIRouter(prefix="/schedule-variants", tags=["schedule-variants"])


@router.get("/", response_model=list[ScheduleVariantResponse])
async def list_variants(project_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list:
    return await svc.list_variants(db, project_id)


@router.post("/", response_model=ScheduleVariantResponse, status_code=201)
async def create_variant(data: ScheduleVariantCreate, db: AsyncSession = Depends(get_db)):
    return await svc.create_variant(db, data)


# Registered ahead of any client-side find-or-create logic — mirrors
# app/api/periods.py's own bootstrap endpoint exactly, same real race it
# guards against.
@router.post("/bootstrap", response_model=ScheduleVariantResponse)
async def bootstrap_variant(project_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await svc.get_or_create_master(db, project_id)


@router.get("/{variant_id}", response_model=ScheduleVariantResponse)
async def get_variant(variant_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await svc.get_variant(db, variant_id)


@router.patch("/{variant_id}", response_model=ScheduleVariantResponse)
async def update_variant(variant_id: uuid.UUID, data: ScheduleVariantUpdate, db: AsyncSession = Depends(get_db)):
    return await svc.update_variant(db, variant_id, data)


@router.delete("/{variant_id}", status_code=204)
async def delete_variant(variant_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    await svc.delete_variant(db, variant_id)
    return Response(status_code=204)


@router.post("/{variant_id}/promote", response_model=PromoteVariantResponse)
async def promote_variant(variant_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    variant, unmatched_codes = await svc.promote_variant(db, variant_id)
    return PromoteVariantResponse(variant=variant, unmatched_codes=unmatched_codes)
