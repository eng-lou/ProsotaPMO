from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.material_preset import (
    MaterialPresetCreate, MaterialPresetResponse, MaterialPresetSlot, MaterialPresetUpdate,
)
from app.schemas.model3d_file import PresignedUpload, PresignedUploadRequest
from app.services import material_preset as svc

router = APIRouter(prefix="/material-presets", tags=["material-presets"])


@router.get("/", response_model=list[MaterialPresetResponse])
async def list_presets(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_presets(db, project_id)


# Step 1 of the direct-to-R2 texture upload (2026-09-30) — see
# MaterialPresetCreate's own header for why textures no longer come
# through this backend's request body.
@router.post("/presign", response_model=PresignedUpload)
async def presign_upload(payload: PresignedUploadRequest) -> PresignedUpload:
    return svc.presign_upload(payload.name, payload.content_type)


# JSON with storage keys, not multipart (2026-09-30) — the browser has
# already PUT each texture straight to R2.
@router.post("/", response_model=MaterialPresetResponse, status_code=201)
async def create_preset(
    payload: MaterialPresetCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_preset(db, payload.project_id, payload.name, payload.textures)


# cleared_slots explicitly nulls a slot without uploading a replacement. A
# slot named in neither `textures` nor `cleared_slots` is left completely
# untouched, so renaming a preset with several large existing textures
# doesn't require re-uploading any of them.
@router.patch("/{preset_id}", response_model=MaterialPresetResponse)
async def update_preset(
    preset_id: uuid.UUID,
    payload: MaterialPresetUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_preset(db, preset_id, payload.name, payload.textures, payload.cleared_slots)


@router.get("/{preset_id}/textures/{slot}")
async def download_texture(
    preset_id: uuid.UUID,
    slot: MaterialPresetSlot,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    return await svc.get_texture_download(db, preset_id, slot)


@router.delete("/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_preset(db, preset_id)
    return Response(status_code=204)
