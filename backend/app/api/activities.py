from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.activity import (
    ActivityActualsUpdate,
    ActivityCodeHistoryResponse,
    ActivityCreate,
    ActivityMoveRequest,
    ActivityResponse,
    ActivityUpdate,
    BulkDeleteActivitiesRequest,
    BulkDeleteActivitiesResponse,
    DeleteActivityResponse,
    SetDataDateRequest,
)
from app.services import activity as svc
from app.services import scheduling_reschedule

router = APIRouter(prefix="/activities", tags=["activities"])


@router.get("/", response_model=list[ActivityResponse])
async def list_activities(
    project_id: uuid.UUID,
    schedule_period_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_activities(db, project_id, schedule_period_id)


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
    schedule_period_id: uuid.UUID,
    shift_days: int,
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await scheduling_reschedule.reschedule(db, schedule_period_id, shift_days)


@router.post("/set-data-date")
async def set_data_date(
    schedule_period_id: uuid.UUID,
    data: SetDataDateRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await scheduling_reschedule.set_data_date(db, schedule_period_id, data.date, data.time)


@router.get("/{activity_id}", response_model=ActivityResponse)
async def get_activity(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.get_activity(db, activity_id)


@router.get("/{activity_id}/code-history", response_model=list[ActivityCodeHistoryResponse])
async def list_code_history(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    """Every code change this activity has ever had (auto-logged promotions/
    demotions, plus manual renames) — see app/models/activity_code_history.py."""
    return await svc.list_code_history(db, activity_id)


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


@router.delete("/{activity_id}", response_model=DeleteActivityResponse)
async def delete_activity(
    activity_id: uuid.UUID,
    cascade: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """cascade=false promotes direct children to the deleted activity's own parent
    (they end up "level with" its former siblings) instead of deleting them too.
    Returns archived=True if this was redirected to Archive instead of a real
    delete (the activity, or one in its subtree, appears in a saved baseline
    snapshot) — see app/services/activity.py:delete_activity."""
    archived = await svc.delete_activity(db, activity_id, cascade=cascade)
    return {"archived": archived}


@router.post("/bulk-delete", response_model=BulkDeleteActivitiesResponse)
async def bulk_delete_activities(
    data: BulkDeleteActivitiesRequest,
    db: AsyncSession = Depends(get_db),
):
    """Multi-select delete in the Scheduling grid — always cascades (each id
    and its whole subtree), same as the grid's own bulk-delete confirm text
    already promises. Runs the hierarchy+CPM recompute once for the whole
    batch instead of once per activity — see
    app/services/activity.py:bulk_delete_activities."""
    deleted, archived = await svc.bulk_delete_activities(db, data.activity_ids)
    return {"deleted_count": deleted, "archived_count": archived}


@router.post("/{activity_id}/archive", response_model=list[ActivityResponse])
async def archive_activity(
    activity_id: uuid.UUID,
    cascade: bool = True,
    db: AsyncSession = Depends(get_db),
) -> list:
    """Actualises (100% complete), strips relationships, and reparents under
    the period's reserved Archived WBS, instead of deleting — available as an
    explicit choice for any activity, not just ones Delete would otherwise
    redirect automatically. See app/services/activity.py:archive_activity."""
    return await svc.archive_activity(db, activity_id, cascade=cascade)
