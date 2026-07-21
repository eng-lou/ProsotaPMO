from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.fourd_video import FourDVideoResponse
from app.services import fourd_video as svc

router = APIRouter(prefix="/fourd-videos", tags=["fourd-videos"])


@router.get("/", response_model=list[FourDVideoResponse])
async def list_videos(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_videos(db, project_id)


# multipart/form-data, same shape as model3d_files.py's own upload endpoint.
@router.post("/", response_model=FourDVideoResponse, status_code=201)
async def create_video(
    project_id: uuid.UUID = Form(...),
    name: str = Form(...),
    duration_sec: float = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_video(db, project_id, name, duration_sec, file)


@router.get("/{video_id}/download")
async def download_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    return await svc.get_download(db, video_id)


@router.delete("/{video_id}", status_code=204)
async def delete_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_video(db, video_id)
    return Response(status_code=204)
