from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.dashboard_layout import DashboardLayoutConfig, DashboardLayoutCreate, DashboardLayoutResponse, DashboardLayoutUpdate
from app.services import dashboard_layout as svc

router = APIRouter(prefix="/dashboard-layouts", tags=["dashboard-layouts"])


@router.get("/", response_model=list[DashboardLayoutResponse])
async def list_layouts(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_layouts(db, project_id)


@router.get("/active-config", response_model=DashboardLayoutConfig)
async def get_active_config(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Cheap fetch for Overview.tsx on mount — the config of whichever
    layout is currently applied, or the built-in defaults if none is."""
    return await svc.get_active_config(db, project_id)


@router.post("/", response_model=DashboardLayoutResponse, status_code=201)
async def create_layout(
    data: DashboardLayoutCreate,
    db: AsyncSession = Depends(get_db),
):
    """Saves a named widget arrangement — does not apply it (see /apply below)."""
    return await svc.create_layout(db, data)


@router.post("/{layout_id}/apply", response_model=DashboardLayoutResponse)
async def apply_layout(
    layout_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Makes this the active layout for its project, clearing any other."""
    return await svc.apply_layout(db, layout_id)


@router.patch("/{layout_id}", response_model=DashboardLayoutResponse)
async def update_layout(
    layout_id: uuid.UUID,
    data: DashboardLayoutUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Overwrites a saved layout's name/config in place."""
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
    """Goes back to the built-in dashboard layout without deleting any saved ones."""
    await svc.reset_to_default(db, project_id)
    return Response(status_code=204)
