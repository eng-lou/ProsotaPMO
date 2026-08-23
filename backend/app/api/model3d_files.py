from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.model3d_file import (
    Model3DFileCreate, Model3DFileResponse, Model3DFileUnloadedElementsUpdate, PresignedUpload,
    PresignedUploadRequest,
)
from app.services import model3d_file as svc

router = APIRouter(prefix="/model3d-files", tags=["model3d-files"])


@router.get("/", response_model=list[Model3DFileResponse])
async def list_files(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_files(db, project_id)


# Step 1 of the direct-to-R2 upload (2026-08-23) — see object_storage.py's
# own header for the full "why" (Vercel's hard 4.5MB Function body cap).
@router.post("/presign", response_model=PresignedUpload)
async def presign_upload(payload: PresignedUploadRequest) -> PresignedUpload:
    return svc.presign_upload(payload.name, payload.content_type)


# JSON, not multipart/form-data (2026-08-23, replacing this endpoint's own
# pre-Vercel shape) — the browser has already PUT the file's own bytes
# straight to R2 via the presigned url from /presign above; this only ever
# records the metadata + the resulting storage_key.
@router.post("/", response_model=Model3DFileResponse, status_code=201)
async def create_file(
    payload: Model3DFileCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_file(
        db, payload.project_id, payload.name, payload.kind, payload.source_up_axis,
        payload.storage_key, payload.keep_raw_animation,
    )


@router.get("/{file_id}/download")
async def download_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    return await svc.get_download(db, file_id)


@router.delete("/{file_id}", status_code=204)
async def delete_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_file(db, file_id)
    return Response(status_code=204)


# "Unload Selected"/"Reload IFC" (2026-07-26, per Maro: "if i refresh, i
# expect the elements i unloaded to stay unloaded") — see
# svc.update_unloaded_elements's own header for why this is always a full
# replacement, not an append/remove call.
@router.patch("/{file_id}/unloaded-elements", response_model=Model3DFileResponse)
async def update_unloaded_elements(
    file_id: uuid.UUID,
    payload: Model3DFileUnloadedElementsUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_unloaded_elements(db, file_id, payload.unloaded_elements)
