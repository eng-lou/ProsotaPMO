from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.resource import ResourceAssignmentCreate, ResourceAssignmentResponse, ResourceAssignmentUpdate
from app.services import resource_assignment as svc

router = APIRouter(prefix="/resource-assignments", tags=["resource-assignments"])


@router.get("/", response_model=list[ResourceAssignmentResponse])
async def list_assignments(
    activity_id: uuid.UUID | None = None,
    schedule_period_id: uuid.UUID | None = None,
    resource_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list:
    # schedule_period_id bulk-loads every assignment across the schedule period in
    # one call (e.g. for the Scheduling table's Resources column) — same pattern as
    # activity-relationships' own schedule_period_id filter. resource_id is the
    # reverse lookup (2026-07-27) — every assignment a single resource has, across
    # whichever activities it's linked to, so the Resource Pool's "Delete All" can
    # cascade-clear a resource's own assignments before deleting it.
    if activity_id is not None:
        return await svc.list_assignments(db, activity_id)
    if schedule_period_id is not None:
        return await svc.list_assignments_for_period(db, schedule_period_id)
    if resource_id is not None:
        return await svc.list_assignments_for_resource(db, resource_id)
    raise HTTPException(status_code=422, detail="activity_id, schedule_period_id, or resource_id is required")


@router.post("/", response_model=ResourceAssignmentResponse, status_code=201)
async def create_assignment(
    data: ResourceAssignmentCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_assignment(db, data)


@router.patch("/{assignment_id}", response_model=ResourceAssignmentResponse)
async def update_assignment(
    assignment_id: uuid.UUID,
    data: ResourceAssignmentUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_assignment(db, assignment_id, data)


@router.delete("/{assignment_id}", status_code=204)
async def delete_assignment(
    assignment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_assignment(db, assignment_id)
    return Response(status_code=204)
