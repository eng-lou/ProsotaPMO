from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.scheduling_quality_run import (
    SchedulingQualityRunCreate,
    SchedulingQualityRunResponse,
    SchedulingQualityRunSummary,
)
from app.services import scheduling_quality_run as svc

router = APIRouter(prefix="/scheduling-quality-runs", tags=["scheduling-quality-runs"])


@router.get("/", response_model=list[SchedulingQualityRunSummary])
async def list_runs(
    schedule_period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_runs(db, schedule_period_id)


@router.post("/", response_model=SchedulingQualityRunResponse, status_code=201)
async def create_run(
    data: SchedulingQualityRunCreate,
    db: AsyncSession = Depends(get_db),
):
    """Snapshots the current live Schedule Quality Analysis under a name, so
    it can be revisited later even after the schedule (and thus the live
    report) has changed — "save the test to view again" (Maro)."""
    return await svc.create_run(db, data)


@router.get("/{run_id}", response_model=SchedulingQualityRunResponse)
async def get_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.get_run(db, run_id)


@router.delete("/{run_id}", status_code=204)
async def delete_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_run(db, run_id)
    return Response(status_code=204)
