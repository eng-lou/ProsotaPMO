from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.resource import BulkDeleteResourcesResponse, ResourceCreate, ResourceResponse, ResourceUpdate
from app.services import resource as svc

router = APIRouter(prefix="/resources", tags=["resources"])


@router.get("/", response_model=list[ResourceResponse])
async def list_resources(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_resources(db, project_id)


@router.post("/", response_model=ResourceResponse, status_code=201)
async def create_resource(
    data: ResourceCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_resource(db, data)


@router.patch("/{resource_id}", response_model=ResourceResponse)
async def update_resource(
    resource_id: uuid.UUID,
    data: ResourceUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_resource(db, resource_id, data)


@router.delete("/{resource_id}", status_code=204)
async def delete_resource(
    resource_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_resource(db, resource_id)
    return Response(status_code=204)


@router.post("/bulk-delete-all", response_model=BulkDeleteResourcesResponse)
async def bulk_delete_resources(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Resource Pool's "Delete All" — one request instead of the old
    per-resource GET-assignments/DELETE-each/DELETE-resource loop. See
    app/services/resource.py:bulk_delete_resources."""
    deleted, skipped = await svc.bulk_delete_resources(db, project_id)
    return {"deleted_count": deleted, "skipped_names": skipped}
