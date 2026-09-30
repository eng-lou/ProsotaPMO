from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.environment_map import EnvironmentMapCreate, EnvironmentMapResponse
from app.schemas.model3d_file import PresignedUpload, PresignedUploadRequest
from app.services import environment_map as svc

router = APIRouter(prefix="/environment-maps", tags=["environment-maps"])


# The project's saved custom HDR/EXR, or null when it uses the default light.
@router.get("/", response_model=EnvironmentMapResponse | None)
async def get_environment(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.get_for_project(db, project_id)


# Direct-to-R2 upload, same three-step flow as model3d_files.py.
@router.post("/presign", response_model=PresignedUpload)
async def presign_upload(payload: PresignedUploadRequest) -> PresignedUpload:
    return svc.presign_upload(payload.name, payload.content_type)


@router.post("/", response_model=EnvironmentMapResponse, status_code=201)
async def set_environment(
    payload: EnvironmentMapCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.set_for_project(db, payload.project_id, payload.name, payload.storage_key)


@router.get("/{env_id}/download")
async def download_environment(
    env_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    return await svc.get_download(db, env_id)


@router.delete("/{env_id}", status_code=204)
async def delete_environment(
    env_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete(db, env_id)
    return Response(status_code=204)
