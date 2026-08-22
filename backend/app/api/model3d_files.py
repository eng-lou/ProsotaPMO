from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.model3d_file import Model3DFileResponse, Model3DFileUnloadedElementsUpdate, Model3DKind, UpAxis
from app.services import model3d_file as svc

router = APIRouter(prefix="/model3d-files", tags=["model3d-files"])


@router.get("/", response_model=list[Model3DFileResponse])
async def list_files(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_files(db, project_id)


# multipart/form-data, not JSON (2026-07-09) — this app's first real binary
# upload endpoint; project_id/name/kind/source_up_axis arrive as plain form
# fields alongside the file itself, matching the standard FastAPI pattern
# for "some metadata plus a file" rather than a separate two-step
# create-then-attach flow.
@router.post("/", response_model=Model3DFileResponse, status_code=201)
async def create_file(
    project_id: uuid.UUID = Form(...),
    name: str = Form(...),
    kind: Model3DKind = Form(...),
    source_up_axis: UpAxis = Form(...),
    keep_raw_animation: bool = Form(False),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_file(db, project_id, name, kind, source_up_axis, file, keep_raw_animation)


@router.get("/{file_id}/download")
async def download_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
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
