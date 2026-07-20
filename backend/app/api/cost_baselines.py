from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.cost_baseline import CostBaselineCreate, CostBaselineItemResponse, CostBaselineResponse
from app.services import cost_baseline as svc

router = APIRouter(prefix="/cost-baselines", tags=["cost-baselines"])


@router.get("/", response_model=list[CostBaselineResponse])
async def list_baselines(period_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list:
    return await svc.list_baselines(db, period_id)


@router.get("/{baseline_id}/snapshot", response_model=list[CostBaselineItemResponse])
async def get_baseline_snapshot(baseline_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list:
    return await svc.get_baseline_snapshot(db, baseline_id)


@router.post("/", response_model=CostBaselineResponse, status_code=201)
async def create_baseline(data: CostBaselineCreate, db: AsyncSession = Depends(get_db)):
    return await svc.create_baseline(db, data)


@router.delete("/{baseline_id}", status_code=204)
async def delete_baseline(baseline_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    await svc.delete_baseline(db, baseline_id)
    return Response(status_code=204)
