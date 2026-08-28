from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.dashboard import BaselineComparisonResponse, DashboardOverviewResponse
from app.services import dashboard as svc

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/overview", response_model=DashboardOverviewResponse)
async def get_overview(
    project_id: uuid.UUID,
    period_id: uuid.UUID,
    schedule_period_id: uuid.UUID,
    wbs_node_activity_id: uuid.UUID | None = None,
    critical_only: bool = False,
    db: AsyncSession = Depends(get_db),
) -> DashboardOverviewResponse:
    return await svc.get_overview(db, project_id, period_id, schedule_period_id, wbs_node_activity_id, critical_only)


@router.get("/baseline-comparison", response_model=BaselineComparisonResponse)
async def get_baseline_comparison(
    baseline_set_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> BaselineComparisonResponse:
    return await svc.get_baseline_comparison(db, baseline_set_id)
