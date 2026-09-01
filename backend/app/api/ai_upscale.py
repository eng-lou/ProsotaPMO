from __future__ import annotations

from fastapi import APIRouter

from app.schemas.ai_upscale import (
    UpscaleImageRequest, UpscaleImageResult, UpscaleUploadUrl, UpscaleUploadUrlRequest,
)
from app.services import ai_upscale as svc

router = APIRouter(prefix="/ai/upscale", tags=["ai"])


# Step 1 of the direct-to-R2 upload (2026-09-01) — see object_storage.py's
# own header for the full "why" (Vercel's hard 4.5MB Function body cap; a
# supersampled 4K capture routinely exceeds it).
@router.post("/presign", response_model=UpscaleUploadUrl)
async def presign_upscale_upload(payload: UpscaleUploadUrlRequest) -> UpscaleUploadUrl:
    storage_key, upload_url = svc.presign_upload(payload.content_type)
    return UpscaleUploadUrl(storage_key=storage_key, upload_url=upload_url)


# The browser has already PUT the raw capture straight to R2 via /presign
# above by the time this runs — this call is what actually does the work
# (fal.ai Real-ESRGAN), blocking until the enhanced image is ready.
@router.post("/", response_model=UpscaleImageResult)
async def upscale_image(payload: UpscaleImageRequest) -> UpscaleImageResult:
    download_url = await svc.upscale_stored_image(payload.storage_key)
    return UpscaleImageResult(download_url=download_url)
