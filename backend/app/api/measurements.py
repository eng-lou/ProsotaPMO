from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.measurement import MeasurementCreate, MeasurementResponse, MeasurementUpdate
from app.services import measurement as svc

router = APIRouter(prefix="/measurements", tags=["measurements"])


@router.get("/", response_model=list[MeasurementResponse])
async def list_measurements(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_measurements(db, project_id)


@router.post("/", response_model=MeasurementResponse, status_code=201)
async def create_measurement(
    data: MeasurementCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_measurement(db, data)


@router.patch("/{measurement_id}", response_model=MeasurementResponse)
async def update_measurement(
    measurement_id: uuid.UUID,
    data: MeasurementUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_measurement(db, measurement_id, data)


@router.delete("/{measurement_id}", status_code=204)
async def delete_measurement(
    measurement_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_measurement(db, measurement_id)
    return Response(status_code=204)
