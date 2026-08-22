from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.model3d_file import Model3DFileResponse
from app.schemas.site_capture import SiteCaptureKind, SiteCaptureResponse, SiteCaptureUpdate, UpAxis
from app.services import site_capture as svc

router = APIRouter(prefix="/site-captures", tags=["site-captures"])


@router.get("/", response_model=list[SiteCaptureResponse])
async def list_captures(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_captures(db, project_id)


# multipart/form-data, same convention as model3d_files.py's own upload
# endpoint (see that router's own comment) — metadata as plain form fields
# alongside the file itself.
@router.post("/", response_model=SiteCaptureResponse, status_code=201)
async def create_capture(
    project_id: uuid.UUID = Form(...),
    name: str = Form(...),
    captured_at: date = Form(...),
    kind: SiteCaptureKind = Form("xyz"),
    source_up_axis: UpAxis = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_capture(db, project_id, name, captured_at, kind, source_up_axis, file)


@router.patch("/{capture_id}", response_model=SiteCaptureResponse)
async def update_capture(
    capture_id: uuid.UUID,
    data: SiteCaptureUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_capture(db, capture_id, data)


@router.get("/{capture_id}/download")
async def download_capture(
    capture_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    return await svc.get_download(db, capture_id)


@router.delete("/{capture_id}", status_code=204)
async def delete_capture(
    capture_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_capture(db, capture_id)
    return Response(status_code=204)


# Can genuinely take minutes for a real, large multi-scan .e57 (see
# e57_convert.py's own header) — svc.convert_capture offloads the actual
# work to a thread so this doesn't block every other request in the
# meantime, but the HTTP request/response here is still one long-lived
# call, not a background job with polling; acceptable for a rare,
# explicit, one-time-per-capture action rather than a hot path.
@router.post("/{capture_id}/convert", response_model=SiteCaptureResponse)
async def convert_capture(
    capture_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.convert_capture(db, capture_id)


# Same long-single-request shape as .../convert above, same reasoning —
# see svc.generate_ifc's own header for the full Cloud2BIM integration
# story. Returns a Model3DFileResponse, not a SiteCaptureResponse — the
# result is a new, independent IFC import (Model3DFile), not a mutation of
# this capture itself.
@router.post("/{capture_id}/generate-ifc", response_model=Model3DFileResponse)
async def generate_ifc(
    capture_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.generate_ifc(db, capture_id)
