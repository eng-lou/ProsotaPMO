from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.model3d_file import Model3DFileResponse, Model3DKind, UpAxis
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
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_file(db, project_id, name, kind, source_up_axis, file)


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
