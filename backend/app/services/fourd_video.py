from __future__ import annotations

import uuid

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fourd_video import FourDVideo
from app.schemas.fourd_video import FourDVideoResponse, PresignedUpload
from app.services import object_storage
from app.services.fourd_video_storage import CONTENT_TYPE_EXTENSIONS

STORAGE_PREFIX = "fourd-videos"


async def list_videos(db: AsyncSession, project_id: uuid.UUID) -> list[FourDVideoResponse]:
    rows = (await db.execute(
        select(FourDVideo).where(FourDVideo.project_id == project_id).order_by(FourDVideo.created_at.desc())
    )).scalars().all()
    return [FourDVideoResponse.model_validate(r) for r in rows]


# Direct-to-R2 upload (2026-08-23) — see object_storage.py's own header for
# the full "why" (Vercel's hard 4.5MB Function body cap). key extension
# comes from content_type, same convention fourd_video_storage.py's own
# generate_storage_filename already used (a recorded export has no real
# "original filename" to derive one from, just a display name).
def presign_upload(content_type: str) -> PresignedUpload:
    ext = CONTENT_TYPE_EXTENSIONS.get(content_type, ".webm")
    storage_key = f"{STORAGE_PREFIX}/{uuid.uuid4()}{ext}"
    upload_url = object_storage.presigned_put_url(storage_key, content_type)
    return PresignedUpload(storage_key=storage_key, upload_url=upload_url)


async def create_video(
    db: AsyncSession, project_id: uuid.UUID, name: str, duration_sec: float, storage_key: str,
) -> FourDVideoResponse:
    # Unlike Model3DFile, re-exporting under the same name does NOT replace
    # a prior row — each capture (e.g. "before" and "after" of the same
    # sequence) is independently worth keeping, not a re-import of "the same
    # model," so every upload is just a new row.
    try:
        size = await run_in_threadpool(object_storage.head_object_size, storage_key)
    except Exception:
        raise HTTPException(
            status_code=400, detail="Uploaded file not found in storage — the upload may have failed or expired",
        ) from None

    row = FourDVideo(
        project_id=project_id, name=name, storage_filename=storage_key,
        duration_sec=duration_sec, size_bytes=size,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return FourDVideoResponse.model_validate(row)


# Redirects to a presigned R2 GET url (2026-08-23) — R2 serves the object's
# own stored Content-Type back directly (set at upload time via the
# presigned PUT's ContentType param), so the dashboard <video> tag gets the
# correct type without this backend needing to infer/set it, and R2's own
# native HTTP Range support (needed for scrubbing, the reason this used
# FileResponse before) still applies to whatever the browser requests
# directly against the resolved R2 url after following the redirect.
async def get_download(db: AsyncSession, video_id: uuid.UUID) -> RedirectResponse:
    row = await db.get(FourDVideo, video_id)
    if row is None:
        raise HTTPException(status_code=404, detail="4D video not found")
    url = await run_in_threadpool(object_storage.presigned_get_url, row.storage_filename)
    return RedirectResponse(url)


async def delete_video(db: AsyncSession, video_id: uuid.UUID) -> None:
    row = await db.get(FourDVideo, video_id)
    if row is None:
        raise HTTPException(status_code=404, detail="4D video not found")
    await run_in_threadpool(object_storage.delete_object, row.storage_filename)
    await db.delete(row)
    await db.commit()
