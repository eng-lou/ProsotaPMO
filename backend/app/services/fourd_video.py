from __future__ import annotations

import uuid

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fourd_video import FourDVideo
from app.schemas.fourd_video import FourDVideoResponse
from app.services.fourd_video_storage import delete_stored_file, generate_storage_filename, storage_path

# Same defensive cap/chunk size as model3d_file.py — no CDN/chunked-upload
# infrastructure yet, so a single request streams straight to local disk.
# A recorded .webm is far smaller than a federated IFC model in practice,
# but the cap is about catching an obviously-wrong upload, not tuning for
# this specific file kind.
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024


async def list_videos(db: AsyncSession, project_id: uuid.UUID) -> list[FourDVideoResponse]:
    rows = (await db.execute(
        select(FourDVideo).where(FourDVideo.project_id == project_id).order_by(FourDVideo.created_at.desc())
    )).scalars().all()
    return [FourDVideoResponse.model_validate(r) for r in rows]


async def create_video(
    db: AsyncSession, project_id: uuid.UUID, name: str, duration_sec: float, upload: UploadFile,
) -> FourDVideoResponse:
    # Unlike Model3DFile, re-exporting under the same name does NOT replace
    # a prior row — each capture (e.g. "before" and "after" of the same
    # sequence) is independently worth keeping, not a re-import of "the same
    # model," so every upload is just a new row.
    storage_filename = generate_storage_filename(name)
    dest = storage_path(storage_filename)
    size = 0
    try:
        with open(dest, "wb") as out:
            while chunk := await upload.read(CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File too large")
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to save uploaded file")

    row = FourDVideo(
        project_id=project_id, name=name, storage_filename=storage_filename,
        duration_sec=duration_sec, size_bytes=size,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return FourDVideoResponse.model_validate(row)


async def get_download(db: AsyncSession, video_id: uuid.UUID) -> FileResponse:
    row = await db.get(FourDVideo, video_id)
    if row is None:
        raise HTTPException(status_code=404, detail="4D video not found")
    path = storage_path(row.storage_filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored video is missing on disk")
    # media_type="video/webm" (not octet-stream, unlike Model3DFile's
    # download) so a dashboard <video> tag can play it directly; FileResponse
    # supports HTTP range requests out of the box, needed for scrubbing.
    return FileResponse(path, filename=row.name, media_type="video/webm")


async def delete_video(db: AsyncSession, video_id: uuid.UUID) -> None:
    row = await db.get(FourDVideo, video_id)
    if row is None:
        raise HTTPException(status_code=404, detail="4D video not found")
    delete_stored_file(row.storage_filename)
    await db.delete(row)
    await db.commit()
