from __future__ import annotations

from functools import lru_cache

import fal_client
import httpx
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from app.core.config import settings
from app.services import object_storage

STORAGE_PREFIX = "ai-upscales"

# fal-ai/esrgan (2026-09-01, per AI_RENDER_ENHANCEMENT_SCOPE.md's decision:
# faithful super-resolution, not a generative/hallucination-prone model —
# see the superseded Gemini stills idea this replaced). Confirmed against
# fal.ai's own live model schema, not assumed: default model checkpoint is
# "RealESRGAN_x4plus" (plain, no GFPGAN bundled), with GFPGAN-style face
# restoration available only as a separate opt-in `face` bool — passed
# False below to make "plain, not face-restoration" a deliberate choice
# rather than whatever fal.ai's own default happens to be.
MODEL = "fal-ai/esrgan"


@lru_cache(maxsize=1)
def _get_client() -> fal_client.AsyncClient:
    if not settings.fal_key:
        # Fails loudly at call time, not at import time — same reasoning as
        # app/ai/client.py's own _get_client for anthropic_api_key.
        raise HTTPException(status_code=503, detail="AI Enhance is not configured (missing fal_key)")
    return fal_client.AsyncClient(key=settings.fal_key)


# Step 1 of the direct-to-R2 upload (same shape as model3d_file.py's own
# presign_upload) — the frontend PUTs the raw 3D canvas's own captured PNG
# straight to R2 with this, never through this backend's request body.
def presign_upload(content_type: str) -> tuple[str, str]:
    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, "capture.png")
    upload_url = object_storage.presigned_put_url(storage_key, content_type)
    return storage_key, upload_url


# Step 2 — the browser has already PUT the raw capture's own bytes to R2 by
# the time this runs. fal.ai fetches the image itself (it takes a URL, not
# a body upload), so this only ever needs to hand it a presigned GET url,
# never touch the image bytes directly.
#
# No per-texture caching (2026-09-01 simplification, see this module's own
# scope doc, section A) — that only pays off for a *source texture file*
# reused unchanged across many future exports; a captured viewport frame is
# different pixel-for-pixel on every capture (camera angle, model/schedule
# state), so there's nothing to key a cache on here. Cost is pay-per-call at
# capture time instead (~$0.003-0.005/image per the doc's own vendor
# pricing), which the doc's own "Cost shape" section already scopes this
# feature around.
async def upscale_stored_image(storage_key: str) -> str:
    client = _get_client()
    source_url = object_storage.presigned_get_url(storage_key)
    try:
        result = await client.subscribe(MODEL, arguments={
            "image_url": source_url,
            "scale": 2,
            "model": "RealESRGAN_x4plus",
            "face": False,
            "output_format": "png",
        })
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI Enhance failed: {exc}") from exc
    finally:
        # Safe once subscribe() has returned/raised either way — fal.ai has
        # already fetched (or failed to fetch) source_url by then, and this
        # is a purely ephemeral upload with no other reader.
        await run_in_threadpool(object_storage.delete_object, storage_key)
    try:
        result_url = result["image"]["url"]
    except (KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="AI Enhance returned an unexpected response shape") from exc

    async with httpx.AsyncClient() as http:
        response = await http.get(result_url)
        response.raise_for_status()
        data = response.content

    result_key = object_storage.generate_storage_key(STORAGE_PREFIX, "enhanced.png")
    await run_in_threadpool(object_storage.upload_bytes, result_key, data, "image/png")
    return await run_in_threadpool(object_storage.presigned_get_url, result_key)
