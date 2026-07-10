from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.material_preset import MaterialPresetCreate, MaterialPresetResponse, MaterialPresetUpdate
from app.services import material_preset as svc

router = APIRouter(prefix="/material-presets", tags=["material-presets"])


@router.get("/", response_model=list[MaterialPresetResponse])
async def list_presets(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_presets(db, project_id)


@router.post("/", response_model=MaterialPresetResponse, status_code=201)
async def create_preset(
    data: MaterialPresetCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_preset(db, data)


@router.patch("/{preset_id}", response_model=MaterialPresetResponse)
async def update_preset(
    preset_id: uuid.UUID,
    data: MaterialPresetUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_preset(db, preset_id, data)


@router.delete("/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_preset(db, preset_id)
    return Response(status_code=204)
