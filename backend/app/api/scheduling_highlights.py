from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.scheduling_highlight import SchedulingHighlightCreate, SchedulingHighlightResponse, SchedulingHighlightUpdate
from app.services import scheduling_highlight as svc

router = APIRouter(prefix="/scheduling-highlights", tags=["scheduling-highlights"])


@router.get("/", response_model=list[SchedulingHighlightResponse])
async def list_highlights(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_highlights(db, project_id)


@router.post("/", response_model=SchedulingHighlightResponse, status_code=201)
async def create_highlight(
    data: SchedulingHighlightCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_highlight(db, data)


@router.patch("/{highlight_id}", response_model=SchedulingHighlightResponse)
async def update_highlight(
    highlight_id: uuid.UUID,
    data: SchedulingHighlightUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_highlight(db, highlight_id, data)


@router.delete("/{highlight_id}", status_code=204)
async def delete_highlight(
    highlight_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_highlight(db, highlight_id)
    return Response(status_code=204)
