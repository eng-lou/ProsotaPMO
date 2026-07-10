from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.element_transform import ElementTransformResponse, ElementTransformSave
from app.services import element_transform as svc

router = APIRouter(prefix="/element-transforms", tags=["element-transforms"])


@router.get("/", response_model=list[ElementTransformResponse])
async def list_element_transforms(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_transforms(db, project_id)


@router.post("/", response_model=ElementTransformResponse, status_code=201)
async def save_element_transform(
    data: ElementTransformSave,
    db: AsyncSession = Depends(get_db),
):
    return await svc.save_transform(db, data)


@router.delete("/{transform_id}", status_code=204)
async def delete_element_transform(
    transform_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_transform(db, transform_id)
    return Response(status_code=204)
