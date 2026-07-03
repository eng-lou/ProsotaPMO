from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.gantt_layout import GanttLayoutCreate, GanttLayoutResponse, GanttLayoutUpdate, GanttStyle
from app.services import gantt_layout as svc

router = APIRouter(prefix="/gantt-layouts", tags=["gantt-layouts"])


@router.get("/", response_model=list[GanttLayoutResponse])
async def list_layouts(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_layouts(db, project_id)


@router.get("/active-style", response_model=GanttStyle)
async def get_active_style(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Cheap fetch for the viewport/print — the style of whichever layout is
    currently applied, or the built-in defaults if none is."""
    return await svc.get_active_style(db, project_id)


@router.post("/", response_model=GanttLayoutResponse, status_code=201)
async def create_layout(
    data: GanttLayoutCreate,
    db: AsyncSession = Depends(get_db),
):
    """Saves a named style + a snapshot of the project's current letterhead —
    does not apply it (see /apply below)."""
    return await svc.create_layout(db, data)


@router.post("/{layout_id}/apply", response_model=GanttLayoutResponse)
async def apply_layout(
    layout_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Makes this the active layout for its project (clearing any other) and
    pushes its saved letterhead snapshot into the live ProjectLetterhead."""
    return await svc.apply_layout(db, layout_id)


@router.patch("/{layout_id}", response_model=GanttLayoutResponse)
async def update_layout(
    layout_id: uuid.UUID,
    data: GanttLayoutUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Overwrites a saved layout's name/style (and re-captures the current
    live letterhead into its snapshot). If this layout is the active one,
    the style change takes effect immediately."""
    return await svc.update_layout(db, layout_id, data)


@router.delete("/{layout_id}", status_code=204)
async def delete_layout(
    layout_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_layout(db, layout_id)
    return Response(status_code=204)


@router.post("/reset", status_code=204)
async def reset_to_default(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Goes back to the built-in look without deleting any saved layouts."""
    await svc.reset_to_default(db, project_id)
    return Response(status_code=204)
