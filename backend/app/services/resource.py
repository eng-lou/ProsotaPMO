from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import Calendar
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.schemas.resource import ResourceCreate, ResourceUpdate


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
