from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.calendar import (
    CalendarExceptionCreate,
    CalendarExceptionResponse,
    CalendarExceptionUpdate,
)
from app.services import calendar as svc

router = APIRouter(prefix="/calendar-exceptions", tags=["calendar-exceptions"])


@router.get("/", response_model=list[CalendarExceptionResponse])
async def list_exceptions(
    calendar_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_exceptions(db, calendar_id)


@router.post("/", response_model=CalendarExceptionResponse, status_code=201)
async def create_exception(
    data: CalendarExceptionCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_exception(db, data)


@router.patch("/{exception_id}", response_model=CalendarExceptionResponse)
async def update_exception(
    exception_id: uuid.UUID,
    data: CalendarExceptionUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_exception(db, exception_id, data)


@router.delete("/{exception_id}", status_code=204)
async def delete_exception(
    exception_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_exception(db, exception_id)
    return Response(status_code=204)
