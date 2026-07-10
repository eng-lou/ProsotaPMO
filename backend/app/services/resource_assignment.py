from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.schemas.resource import ResourceAssignmentCreate, ResourceAssignmentUpdate
from app.services import cost_sync
from app.services.activity import _require_live_schedule_period
from app.services.resource_costing import compute_assignment_budget


async def _attach_resource_fields(db: AsyncSession, assignments: list[ResourceAssignment]) -> None:
    """Attaches transient resource_name/resource_type/unit/rate/max_hours_per_day/
    budget attributes so ResourceAssignmentResponse can read them — denormalized
    for display, never stored (see app/models/resource_assignment.py)."""
    if not assignments:
        return
    resource_ids = {a.resource_id for a in assignments}
    resources_by_id = {
        r.id: r for r in (await db.execute(select(Resource).where(Resource.id.in_(resource_ids)))).scalars().all()
    }
    activity_ids = {a.activity_id for a in assignments}
    activities_by_id = {
        a.id: a for a in (await db.execute(select(Activity).where(Activity.id.in_(activity_ids)))).scalars().all()
    }
    for a in assignments:
        resource = resources_by_id[a.resource_id]
        activity = activities_by_id.get(a.activity_id)
        a.resource_name = resource.name
        a.resource_type = resource.resource_type
        a.unit = resource.unit
        a.rate = resource.rate
        a.max_hours_per_day = resource.max_hours_per_day
        a.budget = compute_assignment_budget(resource, activity, a)


def _validate_assignment_fields(resource: Resource, quantity, utilisation_pct: object) -> None:
    # material has no sensible default (unlike labour/equipment's utilisation_pct,
    # which defaults to 100% in the costing formula) — a quantity must be given.
    if resource.resource_type == "material" and quantity is None:
        raise HTTPException(status_code=422, detail="quantity is required for material resources")


async def _get_activity(db: AsyncSession, activity_id: uuid.UUID) -> Activity:
    activity = await db.get(Activity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


async def list_assignments(db: AsyncSession, activity_id: uuid.UUID) -> list[ResourceAssignment]:
    result = await db.execute(select(ResourceAssignment).where(ResourceAssignment.activity_id == activity_id))
    assignments = list(result.scalars().all())
    await _attach_resource_fields(db, assignments)
    return assignments


async def list_assignments_for_period(db: AsyncSession, schedule_period_id: uuid.UUID) -> list[ResourceAssignment]:
    """Every assignment across a schedule period in one call — e.g. the
    Scheduling table's Resources column, which needs to show real
    assigned-resource names per row without an N+1 fetch. Same pattern as
    activity_relationship.py:list_relationships."""
    result = await db.execute(
        select(ResourceAssignment)
        .join(Activity, Activity.id == ResourceAssignment.activity_id)
        .where(Activity.schedule_period_id == schedule_period_id)
    )
    assignments = list(result.scalars().all())
    await _attach_resource_fields(db, assignments)
    return assignments


async def get_assignment(db: AsyncSession, assignment_id: uuid.UUID) -> ResourceAssignment:
    assignment = await db.get(ResourceAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Resource assignment not found")
    return assignment


async def create_assignment(db: AsyncSession, data: ResourceAssignmentCreate) -> ResourceAssignment:
    activity = await _get_activity(db, data.activity_id)
    await _require_live_schedule_period(db, activity.schedule_period_id)

    # WBS/Project summary rows CAN be resourced directly (2026-07-08, per Maro —
    # reverses the 2026-07-06 decision that only their children could carry
    # resourcing) — e.g. a prelims/overhead-style `cost` resource attached to a
    # whole package rather than one task. Their own linked CostElement
    # (app/services/cost_sync.py) is just one more independent line item in Cost
    # Plan, no double-counting against their children's own elements — Cost Plan
    # has no WBS-tree rollup today. A summary's start/finish/duration_hours are
    # already populated (rolled up from children), so resource_costing.py's
    # duration-driven formulas work unchanged.
    resource = await db.get(Resource, data.resource_id)
    if resource is None or resource.project_id != activity.project_id:
        raise HTTPException(status_code=404, detail="Resource not found in this project")
    _validate_assignment_fields(resource, data.quantity, data.utilisation_pct)

    assignment = ResourceAssignment(**data.model_dump())
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    await cost_sync.sync_cost_element_from_resources(db, activity.id)
    await _attach_resource_fields(db, [assignment])
    return assignment


async def update_assignment(
    db: AsyncSession, assignment_id: uuid.UUID, data: ResourceAssignmentUpdate
) -> ResourceAssignment:
    assignment = await get_assignment(db, assignment_id)
    activity = await _get_activity(db, assignment.activity_id)
    await _require_live_schedule_period(db, activity.schedule_period_id)

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(assignment, field, value)
    await db.commit()
    await db.refresh(assignment)
    await cost_sync.sync_cost_element_from_resources(db, activity.id)
    await _attach_resource_fields(db, [assignment])
    return assignment


async def delete_assignment(db: AsyncSession, assignment_id: uuid.UUID) -> None:
    assignment = await get_assignment(db, assignment_id)
    activity = await _get_activity(db, assignment.activity_id)
    await _require_live_schedule_period(db, activity.schedule_period_id)

    await db.delete(assignment)
    await db.commit()
    await cost_sync.sync_cost_element_from_resources(db, activity.id)
