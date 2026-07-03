from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.activity import ActivityResponse
from app.schemas.schedule_baseline import ScheduleBaselineCreate, ScheduleBaselineResponse
from app.services import schedule_baseline as svc

router = APIRouter(prefix="/schedule-baselines", tags=["schedule-baselines"])


@router.get("/", response_model=list[ScheduleBaselineResponse])
async def list_baselines(
    period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_baselines(db, period_id)


@router.post("/", response_model=ScheduleBaselineResponse, status_code=201)
async def create_baseline(
    data: ScheduleBaselineCreate,
    db: AsyncSession = Depends(get_db),
):
    """Captures a new named, dated baseline from every activity's current
    start/finish/duration_hours — does not assign it (see /assign below)."""
    return await svc.create_baseline(db, data)


@router.post("/{baseline_id}/assign", response_model=list[ActivityResponse])
async def assign_baseline(
    baseline_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    """Applies a saved baseline: copies its snapshot into bl_start/bl_finish/
    bl_duration_hours on every activity in its period and recomputes
    variance_days, same effect the old one-shot "Set Baseline" action had."""
    return await svc.assign_baseline(db, baseline_id)


@router.delete("/{baseline_id}", status_code=204)
async def delete_baseline(
    baseline_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_baseline(db, baseline_id)
    return Response(status_code=204)
