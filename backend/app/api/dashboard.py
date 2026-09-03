from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.dashboard import (
    BaselineComparisonResponse,
    CostPerformanceTrendResponse,
    DashboardOverviewResponse,
    IcdOpenItemsTrendResponse,
    RiskEmvTrendResponse,
    SpiTrendResponse,
)
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


@router.get("/risk-emv-trend", response_model=RiskEmvTrendResponse)
async def get_risk_emv_trend(
    period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> RiskEmvTrendResponse:
    """Portfolio open-risk EMV exposure across every saved Risk Baseline plus
    a live Current point, so a planner can see whether overall risk exposure
    has been growing, shrinking, or stagnant over time."""
    return await svc.get_risk_emv_trend(db, period_id)


@router.get("/cost-performance-trend", response_model=CostPerformanceTrendResponse)
async def get_cost_performance_trend(
    period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> CostPerformanceTrendResponse:
    """Portfolio BAC/CPI/EAC across every saved Cost Baseline plus a live
    Current point."""
    return await svc.get_cost_performance_trend(db, period_id)


@router.get("/spi-trend", response_model=SpiTrendResponse)
async def get_spi_trend(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> SpiTrendResponse:
    """Portfolio schedule SPI across every BaselineSet that has a linked
    Schedule+Cost baseline pair, plus a live Current point."""
    return await svc.get_spi_trend(db, project_id)


@router.get("/icd-open-items-trend", response_model=IcdOpenItemsTrendResponse)
async def get_icd_open_items_trend(
    period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> IcdOpenItemsTrendResponse:
    """Open Issues/Changes/Decisions counts across every saved ICD Baseline
    plus a live Current point."""
    return await svc.get_icd_open_items_trend(db, period_id)
