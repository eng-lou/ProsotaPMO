from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.cost_baseline import CostBaselineCreate, CostBaselineItemResponse, CostBaselineResponse
from app.schemas.cost_element import CostElementResponse
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


@router.post("/{baseline_id}/assign", response_model=list[CostElementResponse])
async def assign_baseline(baseline_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list:
    """Applies a saved Cost Baseline: copies its snapshot into bl_budget on
    every cost element in its period — the true Budget At Completion every
    EVM formula measures against, until a different baseline is assigned."""
    return await svc.assign_baseline(db, baseline_id)


@router.post("/{baseline_id}/unassign", response_model=list[CostElementResponse])
async def unassign_baseline(baseline_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list:
    """The opposite of /assign: clears is_active and every cost element's
    bl_budget, without deleting the saved baseline — it stays in the list to
    be assigned again later."""
    return await svc.unassign_baseline(db, baseline_id)


@router.delete("/{baseline_id}", status_code=204)
async def delete_baseline(baseline_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    await svc.delete_baseline(db, baseline_id)
    return Response(status_code=204)
