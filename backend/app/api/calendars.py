from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.calendar import CalendarCreate, CalendarResponse, CalendarUpdate
from app.services import calendar as svc

router = APIRouter(prefix="/calendars", tags=["calendars"])


@router.get("/", response_model=list[CalendarResponse])
async def list_calendars(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_calendars(db, project_id)


@router.post("/", response_model=CalendarResponse, status_code=201)
async def create_calendar(
    data: CalendarCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_calendar(db, data)


@router.patch("/{calendar_id}", response_model=CalendarResponse)
async def update_calendar(
    calendar_id: uuid.UUID,
    data: CalendarUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_calendar(db, calendar_id, data)


@router.delete("/{calendar_id}", status_code=204)
async def delete_calendar(
    calendar_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_calendar(db, calendar_id)
    return Response(status_code=204)
