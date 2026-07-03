from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.activity import (
    ActivityActualsUpdate,
    ActivityCreate,
    ActivityMoveRequest,
    ActivityResponse,
    ActivityUpdate,
)
from app.services import activity as svc
from app.services import scheduling_reschedule

router = APIRouter(prefix="/activities", tags=["activities"])


@router.get("/", response_model=list[ActivityResponse])
async def list_activities(
    project_id: uuid.UUID,
    period_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_activities(db, project_id, period_id)


@router.post("/", response_model=ActivityResponse, status_code=201)
async def create_activity(
    data: ActivityCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_activity(db, data)


# Registered before /{activity_id} — "reschedule" would otherwise be attempted as a
# UUID path param by that route first. The old one-shot "set-baseline" action lives
# at /schedule-baselines now (app/api/schedule_baselines.py) — create + assign,
# not a single overwriteable slot.
@router.post("/reschedule")
async def reschedule(
    period_id: uuid.UUID,
    shift_days: int,
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await scheduling_reschedule.reschedule(db, period_id, shift_days)


@router.get("/{activity_id}", response_model=ActivityResponse)
async def get_activity(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.get_activity(db, activity_id)


@router.patch("/{activity_id}", response_model=ActivityResponse)
async def update_activity(
    activity_id: uuid.UUID,
    data: ActivityUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_activity(db, activity_id, data)


@router.post("/{activity_id}/move", response_model=ActivityResponse)
async def move_activity(
    activity_id: uuid.UUID,
    data: ActivityMoveRequest,
    db: AsyncSession = Depends(get_db),
):
    """Moves an activity up or down among its current siblings (display order/
    WBS numbering only — indent/outdent, a parent_id change, is the separate
    lever for hierarchy level)."""
    return await svc.move_activity(db, activity_id, data.direction)


@router.patch("/{activity_id}/actuals", response_model=ActivityResponse)
async def update_activity_actuals(
    activity_id: uuid.UUID,
    data: ActivityActualsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Records Actual Cost against a resourced activity directly from
    Scheduling's Resources tab — matching P6, rather than requiring a trip to
    Cost Plan. 422 if the activity has no resourced cost line yet."""
    return await svc.update_activity_actuals(db, activity_id, data.actuals)


@router.delete("/{activity_id}", status_code=204)
async def delete_activity(
    activity_id: uuid.UUID,
    cascade: bool = True,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """cascade=false promotes direct children to the deleted activity's own parent
    (they end up "level with" its former siblings) instead of deleting them too."""
    await svc.delete_activity(db, activity_id, cascade=cascade)
    return Response(status_code=204)
