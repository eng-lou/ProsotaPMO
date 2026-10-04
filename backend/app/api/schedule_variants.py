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
    ScheduleContextResponse,
)
from app.services import schedule_variant as svc
from app.services import schedule_period

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
# GET as well as POST: see app/api/periods.py's bootstrap_period.
@router.api_route("/bootstrap", methods=["GET", "POST"], response_model=ScheduleVariantResponse)
async def bootstrap_variant(project_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await svc.get_or_create_master(db, project_id)


@router.get("/context", response_model=ScheduleContextResponse)
async def schedule_context(project_id: uuid.UUID, selected_variant_id: uuid.UUID | None = None,
                           db: AsyncSession = Depends(get_db)):
    # Resolve saved selection and its period in one round trip. An ID from
    # another project or a deleted variant must never select foreign data.
    master = await svc.get_or_create_master(db, project_id)
    active = master
    if selected_variant_id and selected_variant_id != master.id:
        variants = await svc.list_variants(db, project_id)
        active = next((v for v in variants if v.id == selected_variant_id), master)
    period = await schedule_period.bootstrap_period(db, active.id)
    return {"variant": active, "period": period}


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
