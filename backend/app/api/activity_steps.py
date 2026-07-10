from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.activity_step import (
    ActivityStepCreate,
    ActivityStepMoveRequest,
    ActivityStepResponse,
    ActivityStepUpdate,
)
from app.services import activity_step as svc

router = APIRouter(prefix="/activity-steps", tags=["activity-steps"])


@router.get("/", response_model=list[ActivityStepResponse])
async def list_steps(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_steps(db, activity_id)


@router.post("/", response_model=ActivityStepResponse, status_code=201)
async def create_step(
    data: ActivityStepCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_step(db, data)


@router.patch("/{step_id}", response_model=ActivityStepResponse)
async def update_step(
    step_id: uuid.UUID,
    data: ActivityStepUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_step(db, step_id, data)


@router.delete("/{step_id}", status_code=204)
async def delete_step(
    step_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_step(db, step_id)
    return Response(status_code=204)


@router.post("/{step_id}/move", response_model=ActivityStepResponse)
async def move_step(
    step_id: uuid.UUID,
    data: ActivityStepMoveRequest,
    db: AsyncSession = Depends(get_db),
):
    return await svc.move_step(db, step_id, data.direction)
