from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.activity import ActivityResponse
from app.schemas.schedule_baseline import (
    PromoteBaselineCreate,
    PromoteBaselineResponse,
    ScheduleBaselineActivityResponse,
    ScheduleBaselineCreate,
    ScheduleBaselineFromVariantCreate,
    ScheduleBaselineResponse,
)
from app.services import schedule_baseline as svc

router = APIRouter(prefix="/schedule-baselines", tags=["schedule-baselines"])


@router.get("/", response_model=list[ScheduleBaselineResponse])
async def list_baselines(
    schedule_period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_baselines(db, schedule_period_id)


@router.get("/{baseline_id}/snapshot", response_model=list[ScheduleBaselineActivityResponse])
async def get_baseline_snapshot(
    baseline_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    """Every activity's captured code/start/finish/duration_hours as of this
    baseline — for code traceability ("what was it in the baseline") against
    the live activity's current values."""
    return await svc.get_baseline_snapshot(db, baseline_id)


@router.post("/", response_model=ScheduleBaselineResponse, status_code=201)
async def create_baseline(
    data: ScheduleBaselineCreate,
    db: AsyncSession = Depends(get_db),
):
    """Captures a new named, dated baseline from every activity's current
    start/finish/duration_hours — does not assign it (see /assign below)."""
    return await svc.create_baseline(db, data)


@router.post("/from-variant", response_model=ScheduleBaselineResponse, status_code=201)
async def create_baseline_from_variant(
    data: ScheduleBaselineFromVariantCreate,
    db: AsyncSession = Depends(get_db),
):
    """Cross-variant baselining (docs/SCHEDULE_VARIANTS_PLAN.md §D.7) —
    populates the new baseline from a *different* schedule variant's current
    live activities, matched by code, rather than the target period's own
    current state. Also does not assign it — same two-step capture/apply
    discipline as the regular create above."""
    return await svc.create_baseline_from_variant(db, data)


@router.post("/{baseline_id}/assign", response_model=list[ActivityResponse])
async def assign_baseline(
    baseline_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    """Applies a saved baseline: copies its snapshot into bl_start/bl_finish/
    bl_duration_hours on every activity in its period and recomputes
    variance_days, same effect the old one-shot "Set Baseline" action had."""
    return await svc.assign_baseline(db, baseline_id)


@router.post("/{baseline_id}/unassign", response_model=list[ActivityResponse])
async def unassign_baseline(
    baseline_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    """The opposite of /assign: clears is_active and every activity's
    bl_start/bl_finish/bl_duration_hours/variance_days, without deleting the
    saved baseline — it stays in the list to be assigned again later."""
    return await svc.unassign_baseline(db, baseline_id)


@router.post("/{baseline_id}/promote", response_model=PromoteBaselineResponse, status_code=201)
async def promote_baseline_to_variant(
    baseline_id: uuid.UUID,
    data: PromoteBaselineCreate,
    db: AsyncSession = Depends(get_db),
):
    """"Open a baseline as a working schedule" — forks a brand new, editable
    ScheduleVariant seeded from this baseline's own captured snapshot
    (activities, durations, constraints, and relationships), independent of
    the source schedule from here on."""
    variant, relationships_from_baseline_snapshot = await svc.promote_baseline_to_variant(db, baseline_id, data)
    return PromoteBaselineResponse(
        variant=variant, relationships_from_baseline_snapshot=relationships_from_baseline_snapshot
    )


@router.delete("/{baseline_id}", status_code=204)
async def delete_baseline(
    baseline_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_baseline(db, baseline_id)
    return Response(status_code=204)
