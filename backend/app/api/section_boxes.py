from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.section_box import SectionBoxCreate, SectionBoxResponse, SectionBoxUpdate
from app.services import section_box as svc

router = APIRouter(prefix="/section-boxes", tags=["section-boxes"])


@router.get("/", response_model=list[SectionBoxResponse])
async def list_section_boxes(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_section_boxes(db, project_id)


@router.post("/", response_model=SectionBoxResponse, status_code=201)
async def create_section_box(
    data: SectionBoxCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_section_box(db, data)


@router.patch("/{box_id}", response_model=SectionBoxResponse)
async def update_section_box(
    box_id: uuid.UUID,
    data: SectionBoxUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_section_box(db, box_id, data)


@router.delete("/{box_id}", status_code=204)
async def delete_section_box(
    box_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_section_box(db, box_id)
    return Response(status_code=204)
