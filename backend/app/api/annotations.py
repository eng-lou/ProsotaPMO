from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.annotation import AnnotationCreate, AnnotationResponse, AnnotationUpdate
from app.services import annotation as svc

router = APIRouter(prefix="/annotations", tags=["annotations"])


@router.get("/", response_model=list[AnnotationResponse])
async def list_annotations(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_annotations(db, project_id)


@router.post("/", response_model=AnnotationResponse, status_code=201)
async def create_annotation(
    data: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_annotation(db, data)


@router.patch("/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(
    annotation_id: uuid.UUID,
    data: AnnotationUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_annotation(db, annotation_id, data)


@router.delete("/{annotation_id}", status_code=204)
async def delete_annotation(
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_annotation(db, annotation_id)
    return Response(status_code=204)
