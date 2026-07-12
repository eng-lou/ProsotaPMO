from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.path import PathCreate, PathResponse, PathUpdate
from app.services import path as svc

router = APIRouter(prefix="/paths", tags=["paths"])


@router.get("/", response_model=list[PathResponse])
async def list_paths(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_paths(db, project_id)


@router.post("/", response_model=PathResponse, status_code=201)
async def create_path(
    data: PathCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_path(db, data)


@router.patch("/{path_id}", response_model=PathResponse)
async def update_path(
    path_id: uuid.UUID,
    data: PathUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_path(db, path_id, data)


@router.delete("/{path_id}", status_code=204)
async def delete_path(
    path_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_path(db, path_id)
    return Response(status_code=204)
