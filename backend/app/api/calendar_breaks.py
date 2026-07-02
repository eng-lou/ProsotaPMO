from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.calendar import CalendarBreakCreate, CalendarBreakResponse, CalendarBreakUpdate
from app.services import calendar as svc

router = APIRouter(prefix="/calendar-breaks", tags=["calendar-breaks"])


@router.get("/", response_model=list[CalendarBreakResponse])
async def list_breaks(
    calendar_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_breaks(db, calendar_id)


@router.post("/", response_model=CalendarBreakResponse, status_code=201)
async def create_break(
    data: CalendarBreakCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_break(db, data)


@router.patch("/{break_id}", response_model=CalendarBreakResponse)
async def update_break(
    break_id: uuid.UUID,
    data: CalendarBreakUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_break(db, break_id, data)


@router.delete("/{break_id}", status_code=204)
async def delete_break(
    break_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_break(db, break_id)
    return Response(status_code=204)
