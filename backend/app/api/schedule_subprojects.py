from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.schedule_subproject import ScheduleSubprojectCreate, ScheduleSubprojectResponse, ScheduleSubprojectUpdate
from app.services import schedule_subproject as svc

router = APIRouter(prefix="/schedule-subprojects", tags=["schedule-subprojects"])


@router.get("/", response_model=list[ScheduleSubprojectResponse])
async def list_subprojects(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_subprojects(db, project_id)


@router.post("/", response_model=ScheduleSubprojectResponse, status_code=201)
async def create_subproject(
    data: ScheduleSubprojectCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_subproject(db, data)


@router.patch("/{subproject_id}", response_model=ScheduleSubprojectResponse)
async def update_subproject(
    subproject_id: uuid.UUID,
    data: ScheduleSubprojectUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_subproject(db, subproject_id, data)


@router.delete("/{subproject_id}", status_code=204)
async def delete_subproject(
    subproject_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_subproject(db, subproject_id)
    return Response(status_code=204)
