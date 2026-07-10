from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.schedule_period import SchedulePeriodCreate, SchedulePeriodResponse, SchedulePeriodUpdate
from app.services import schedule_period as svc

router = APIRouter(prefix="/schedule-periods", tags=["schedule-periods"])


@router.get("/", response_model=list[SchedulePeriodResponse])
async def list_periods(schedule_variant_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list:
    return await svc.list_periods(db, schedule_variant_id)


@router.post("/", response_model=SchedulePeriodResponse, status_code=201)
async def create_period(data: SchedulePeriodCreate, db: AsyncSession = Depends(get_db)):
    return await svc.create_period(db, data)


@router.post("/bootstrap", response_model=SchedulePeriodResponse)
async def bootstrap_period(schedule_variant_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await svc.bootstrap_period(db, schedule_variant_id)


@router.get("/{period_id}", response_model=SchedulePeriodResponse)
async def get_period(period_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await svc.get_period(db, period_id)


@router.patch("/{period_id}", response_model=SchedulePeriodResponse)
async def update_period(period_id: uuid.UUID, data: SchedulePeriodUpdate, db: AsyncSession = Depends(get_db)):
    return await svc.update_period(db, period_id, data)


@router.delete("/{period_id}", status_code=204)
async def delete_period(period_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    await svc.delete_period(db, period_id)
    return Response(status_code=204)
