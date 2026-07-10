from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.model_element_link import ModelElementLinkCreate, ModelElementLinkResponse, ModelElementLinkUpdate
from app.services import model_element_link as svc

router = APIRouter(prefix="/model-element-links", tags=["model-element-links"])


@router.get("/", response_model=list[ModelElementLinkResponse])
async def list_model_element_links(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_links(db, project_id)


@router.post("/", response_model=ModelElementLinkResponse, status_code=201)
async def create_model_element_link(
    data: ModelElementLinkCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_link(db, data)


@router.patch("/{link_id}", response_model=ModelElementLinkResponse)
async def update_model_element_link(
    link_id: uuid.UUID,
    data: ModelElementLinkUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_link(db, link_id, data)


@router.delete("/{link_id}", status_code=204)
async def delete_model_element_link(
    link_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_link(db, link_id)
    return Response(status_code=204)
