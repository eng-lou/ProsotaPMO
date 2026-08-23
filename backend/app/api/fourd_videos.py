from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.fourd_video import FourDVideoCreate, FourDVideoResponse, PresignedUpload, PresignedUploadRequest
from app.services import fourd_video as svc

router = APIRouter(prefix="/fourd-videos", tags=["fourd-videos"])


@router.get("/", response_model=list[FourDVideoResponse])
async def list_videos(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_videos(db, project_id)


# Step 1 of the direct-to-R2 upload (2026-08-23) — see object_storage.py's
# own header for the full "why" (Vercel's hard 4.5MB Function body cap).
@router.post("/presign", response_model=PresignedUpload)
async def presign_upload(payload: PresignedUploadRequest) -> PresignedUpload:
    return svc.presign_upload(payload.content_type)


# JSON, not multipart/form-data (2026-08-23, replacing this endpoint's own
# pre-Vercel shape) — the browser has already PUT the file's own bytes
# straight to R2 via the presigned url from /presign above.
@router.post("/", response_model=FourDVideoResponse, status_code=201)
async def create_video(
    payload: FourDVideoCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_video(db, payload.project_id, payload.name, payload.duration_sec, payload.storage_key)


@router.get("/{video_id}/download")
async def download_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    return await svc.get_download(db, video_id)


@router.delete("/{video_id}", status_code=204)
async def delete_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_video(db, video_id)
    return Response(status_code=204)
