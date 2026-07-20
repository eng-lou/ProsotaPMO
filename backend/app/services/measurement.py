from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.measurement import Measurement
from app.schemas.measurement import MeasurementCreate, MeasurementResponse, MeasurementUpdate


async def list_measurements(db: AsyncSession, project_id: uuid.UUID) -> list[MeasurementResponse]:
    rows = (await db.execute(
        select(Measurement).where(Measurement.project_id == project_id).order_by(Measurement.created_at)
    )).scalars().all()
    return [MeasurementResponse.model_validate(r) for r in rows]


async def create_measurement(db: AsyncSession, data: MeasurementCreate) -> MeasurementResponse:
    row = Measurement(**data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return MeasurementResponse.model_validate(row)


async def update_measurement(db: AsyncSession, measurement_id: uuid.UUID, data: MeasurementUpdate) -> MeasurementResponse:
    row = await db.get(Measurement, measurement_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return MeasurementResponse.model_validate(row)


async def delete_measurement(db: AsyncSession, measurement_id: uuid.UUID) -> None:
    row = await db.get(Measurement, measurement_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    await db.delete(row)
    await db.commit()
