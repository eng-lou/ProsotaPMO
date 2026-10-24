from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, HTTPException
from app.core.auth import get_db_user
from app.services.clash_access import owned_project
from app.models.activity import Activity
from app.models.model_element_link import ModelElementLink
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.model_element_link import (
    ModelElementLinkBulkCreate,
    ModelElementLinkBulkResponse,
    ModelElementLinkCreate,
    ModelElementLinkResponse,
    ModelElementLinkUpdate,
)
from app.services import model_element_link as svc

router = APIRouter(prefix="/model-element-links", tags=["model-element-links"])


@router.get("/", response_model=list[ModelElementLinkResponse])
async def list_model_element_links(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_db_user),
) -> list:
    await owned_project(db, project_id, user)
    return await svc.list_links(db, project_id)


@router.post("/", response_model=ModelElementLinkResponse, status_code=201)
async def create_model_element_link(
    data: ModelElementLinkCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_db_user),
):
    await check_activity(db, data.activity_id, user)
    return await svc.create_link(db, data)


# Bulk create (2026-09-01) — see create_links_bulk's own docstring. A
# distinct route (not an overload of "/") since it takes an activity_id +
# list shape rather than one flat ModelElementLinkCreate.
@router.post("/bulk", response_model=ModelElementLinkBulkResponse, status_code=201)
async def create_model_element_links_bulk(
    data: ModelElementLinkBulkCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_db_user),
):
    await check_activity(db, data.activity_id, user)
    return await svc.create_links_bulk(db, data)


@router.patch("/{link_id}", response_model=ModelElementLinkResponse)
async def update_model_element_link(
    link_id: uuid.UUID,
    data: ModelElementLinkUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_db_user),
):
    await check_link(db, link_id, user)
    return await svc.update_link(db, link_id, data)


@router.delete("/{link_id}", status_code=204)
async def delete_model_element_link(
    link_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_db_user),
) -> Response:
    await check_link(db, link_id, user)
    await svc.delete_link(db, link_id)
    return Response(status_code=204)


async def check_activity(db, id, user):
    row = await db.get(Activity, id)
    if not row:
        raise HTTPException(404, "Activity not found")
    await owned_project(db, row.project_id, user)


async def check_link(db, id, user):
    row = await db.get(ModelElementLink, id)
    if not row:
        raise HTTPException(404, "Link not found")
    await owned_project(db, row.project_id, user)
