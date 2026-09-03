from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.calendar import Calendar
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.schedule_period import SchedulePeriod
from app.schemas.resource import ResourceCreate, ResourceUpdate
from app.services import cost_sync


async def _validate_calendar_in_project(db: AsyncSession, calendar_id: uuid.UUID, project_id: uuid.UUID) -> None:
    calendar = await db.get(Calendar, calendar_id)
    if calendar is None or calendar.project_id != project_id:
        raise HTTPException(status_code=404, detail="Calendar not found in this project")


async def list_resources(db: AsyncSession, project_id: uuid.UUID) -> list[Resource]:
    result = await db.execute(select(Resource).where(Resource.project_id == project_id).order_by(Resource.name))
    return list(result.scalars().all())


async def get_resource(db: AsyncSession, resource_id: uuid.UUID) -> Resource:
    resource = await db.get(Resource, resource_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    return resource


async def create_resource(db: AsyncSession, data: ResourceCreate) -> Resource:
    if data.calendar_id is not None:
        await _validate_calendar_in_project(db, data.calendar_id, data.project_id)
    resource = Resource(**data.model_dump())
    db.add(resource)
    await db.commit()
    await db.refresh(resource)
    return resource


async def update_resource(db: AsyncSession, resource_id: uuid.UUID, data: ResourceUpdate) -> Resource:
    resource = await get_resource(db, resource_id)
    updates = data.model_dump(exclude_unset=True)
    if updates.get("calendar_id") is not None:
        await _validate_calendar_in_project(db, updates["calendar_id"], resource.project_id)
    for field, value in updates.items():
        setattr(resource, field, value)
    await db.commit()
    await db.refresh(resource)
    return resource


async def delete_resource(db: AsyncSession, resource_id: uuid.UUID) -> None:
    resource = await get_resource(db, resource_id)
    in_use = await db.execute(
        select(ResourceAssignment.id).where(ResourceAssignment.resource_id == resource_id).limit(1)
    )
    if in_use.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=422,
            detail="This resource is still assigned to one or more activities — remove those assignments first.",
        )
    await db.delete(resource)
    await db.commit()


async def bulk_delete_resources(db: AsyncSession, project_id: uuid.UUID) -> tuple[int, list[str]]:
    """Resource Pool's "Delete All" (ResourcePoolWidget.tsx's own
    handleDeleteAll) used to do, per resource: one GET for its assignments,
    one DELETE per assignment, then one DELETE for the resource itself — all
    sequential HTTP round trips (2026-09-03, per Maro: "takes a long time to
    delete all activities and all resources" — a pool with even a few dozen
    resources each with a handful of assignments meant hundreds of
    sequential requests). One request, batched queries throughout.

    Same "skip anything in a frozen schedule period" behaviour as before —
    a resource with an assignment on a frozen period keeps that assignment
    (frozen periods reject writes) and is therefore still in use, so it's
    left alone rather than reported as a hard failure.

    Returns (deleted_count, skipped_names)."""
    resources = await list_resources(db, project_id)
    if not resources:
        return 0, []
    resource_ids = [r.id for r in resources]

    assignments = (await db.execute(
        select(ResourceAssignment).where(ResourceAssignment.resource_id.in_(resource_ids))
    )).scalars().all()
    if assignments:
        activities = (await db.execute(
            select(Activity).where(Activity.id.in_({a.activity_id for a in assignments}))
        )).scalars().all()
        activity_by_id = {a.id: a for a in activities}
        period_ids = {a.schedule_period_id for a in activity_by_id.values()}
        periods = (await db.execute(select(SchedulePeriod).where(SchedulePeriod.id.in_(period_ids)))).scalars().all()
        frozen_period_ids = {p.id for p in periods if p.freeze_status != "live"}

        deletable_assignments = []
        frozen_resource_ids: set[uuid.UUID] = set()
        for a in assignments:
            activity = activity_by_id.get(a.activity_id)
            if activity is not None and activity.schedule_period_id in frozen_period_ids:
                frozen_resource_ids.add(a.resource_id)
            else:
                deletable_assignments.append(a)

        if deletable_assignments:
            await db.execute(delete(ResourceAssignment).where(
                ResourceAssignment.id.in_({a.id for a in deletable_assignments})
            ))
            await db.commit()
            for activity_id in {a.activity_id for a in deletable_assignments}:
                await cost_sync.sync_cost_element_from_resources(db, activity_id, commit=False)
            await db.commit()
    else:
        frozen_resource_ids = set()

    deletable_resource_ids = [r.id for r in resources if r.id not in frozen_resource_ids]
    skipped_names = [r.name for r in resources if r.id in frozen_resource_ids]
    if deletable_resource_ids:
        await db.execute(delete(Resource).where(Resource.id.in_(deletable_resource_ids)))
        await db.commit()
    return len(deletable_resource_ids), skipped_names
