from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, HTTPException
from fastapi.concurrency import run_in_threadpool
from app.core.auth import get_db_user
from app.models.model3d_file import Model3DFile
from app.models.project import Project
from app.services.ifc_conversion import prepare_ifc4
from pydantic import BaseModel
from app.services import ifc_planning_import
from sqlalchemy.exc import IntegrityError
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.model3d_file import (
    Model3DFileCreate, Model3DFileResponse, Model3DFileUnloadedElementsUpdate, PresignedUpload,
    PresignedUploadRequest,
)
from app.services import model3d_file as svc

router = APIRouter(prefix="/model3d-files", tags=["model3d-files"])


class PlanningImportRequest(BaseModel):
    schedule_period_id: uuid.UUID
    cost_period_id: uuid.UUID
    commit: bool = False


@router.post("/{file_id}/planning-import")
async def planning_import(file_id: uuid.UUID, payload: PlanningImportRequest, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await db.get(Model3DFile, file_id)
    project = await db.get(Project, row.project_id) if row else None
    if project is None or project.org_id != user.org_id or project.created_by != user.id:
        raise HTTPException(404, 'Model file not found')
    if row.kind != 'ifc': raise HTTPException(422, 'Select an IFC model')
    snapshot = await run_in_threadpool(ifc_planning_import.read_snapshot, row.storage_filename)
    if not payload.commit:
        return {'counts': {k: len(snapshot[k]) for k in ('activities','relationships','resources','assignments','calendars','costs','links')}, 'warnings': snapshot['warnings']}
    try:
        counts = await ifc_planning_import.restore(db, row.project_id, payload.schedule_period_id, payload.cost_period_id, snapshot)
    except (ValueError, KeyError, TypeError, ArithmeticError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(422, 'The planning snapshot has invalid or unresolved records; no planning data was imported.') from exc
    return {'counts': counts, 'warnings': snapshot['warnings']}


@router.post("/{file_id}/ifc4-export-source")
async def ifc4_export_source(file_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await db.get(Model3DFile, file_id)
    project = await db.get(Project, row.project_id) if row else None
    if project is None or project.org_id != user.org_id or project.created_by != user.id:
        raise HTTPException(404, "Model file not found")
    if row.kind != "ifc":
        raise HTTPException(422, "Only IFC models can be converted")
    url = await run_in_threadpool(prepare_ifc4, row.id, row.storage_filename)
    return {"download_url": url}


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
