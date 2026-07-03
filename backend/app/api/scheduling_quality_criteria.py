from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.scheduling_quality_criterion import SchedulingQualityCriterionResponse, SchedulingQualityCriterionUpdate
from app.services import scheduling_quality_criterion as svc

router = APIRouter(prefix="/scheduling-quality-criteria", tags=["scheduling-quality-criteria"])


@router.get("/", response_model=list[SchedulingQualityCriterionResponse])
async def list_criteria(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_criteria(db, project_id)


@router.patch("/{criterion_id}", response_model=SchedulingQualityCriterionResponse)
async def update_criterion(
    criterion_id: uuid.UUID,
    data: SchedulingQualityCriterionUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_criterion(db, criterion_id, data)


@router.post("/reset", response_model=list[SchedulingQualityCriterionResponse])
async def reset_criteria(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.reset_criteria(db, project_id)
