from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.concurrency import run_in_threadpool
from app.core.auth import get_db_user
from app.services.clash_access import owned_project
from app.services import object_storage
from app.services.annotation_media import publish_media
from app.models.annotation import AnnotationMedia
from app.schemas.annotation_callout import CalloutMediaCreate
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.annotation import AnnotationCreate, AnnotationResponse, AnnotationUpdate
from app.services import annotation as svc

router = APIRouter(prefix="/annotations", tags=["annotations"])


@router.get("/", response_model=list[AnnotationResponse])
async def list_annotations(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_annotations(db, project_id)


@router.post("/", response_model=AnnotationResponse, status_code=201)
async def create_annotation(
    data: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_annotation(db, data)


@router.patch("/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(
    annotation_id: uuid.UUID,
    data: AnnotationUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_annotation(db, annotation_id, data)


@router.delete("/{annotation_id}", status_code=204)
async def delete_annotation(
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_annotation(db, annotation_id)
    return Response(status_code=204)


@router.post("/media", status_code=201)
async def register_media(data: CalloutMediaCreate, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_project(db, data.project_id, user)
    row = AnnotationMedia(id=uuid.uuid4(), **data.model_dump())
    db.add(row)
    await db.commit()
    return {"id": row.id, "upload_url": object_storage.presigned_put_url(row.storage_key + ".pending", row.content_type)}


async def owned_media(db, media_id, user):
    row = await db.get(AnnotationMedia, media_id)
    if row is None:
        raise HTTPException(404, "Media not found")
    await owned_project(db, row.project_id, user)
    return row


@router.post("/media/{media_id}/ready")
async def ready_media(media_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned_media(db, media_id, user)
    if not row.ready:
        try:
            await run_in_threadpool(publish_media, row)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        row.ready = True
        await db.commit()
        await run_in_threadpool(object_storage.delete_object, row.storage_key + ".pending")
    return {"id": row.id}


@router.get("/media/{media_id}/download")
async def download_media(media_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned_media(db, media_id, user)
    if not row.ready:
        raise HTTPException(409, "Media upload is not complete")
    return RedirectResponse(object_storage.presigned_get_url(row.storage_key))
