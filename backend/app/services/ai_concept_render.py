from __future__ import annotations

from functools import lru_cache

import httpx
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from google import genai
from google.genai import types

from app.core.config import settings
from app.services import ai_upscale, object_storage

STORAGE_PREFIX = "ai-concept-renders"

# gemini-3.1-flash-image ("Nano Banana 2", confirmed against Google's own
# live docs 2026-09-02 — model names in this space churn fast, re-verify
# against ai.google.dev/gemini-api/docs/image-generation if this ever
# starts 404ing). Image comes back as a Part with inline_data — verified
# against the installed google-genai==2.21.0 SDK's own real type
# signatures, not assumed from docs alone. NOT yet live-tested against a
# real key (no Gemini key was available while building this) — same
# "confirm before trusting" caveat as this file's own prompt below; the
# first real call should be treated as a verification step, not an
# assumed-working integration.
MODEL = "gemini-3.1-flash-image"

# Guardrail prompt (2026-09-02, per Maro: "improved results but more like
# photoshop level not hallucinating by adding objects i did not ask for")
# — this is the entire reason Concept Render exists as a *separate*,
# explicitly-labeled mode instead of just replacing fal.ai: a schedule/IFC
# -tied engineering tool can't risk a stakeholder mistaking an invented
# rooftop unit or a repainted brick pattern for real model data (see
# AI_RENDER_ENHANCEMENT_SCOPE.md's own "What NOT to build"). This prompt is
# the actual enforcement mechanism for that boundary — always sent, with
# the user's own optional prompt appended as an addition, never a
# replacement, so a user-supplied prompt can't accidentally drop the
# guardrail.
GUARDRAIL_PROMPT = (
    "You are enhancing a 3D architectural/engineering render into a "
    "photorealistic image — a Photoshop-level materials/lighting retouch, "
    "not a reimagining. Improve surface materials, textures, lighting, and "
    "photographic realism only. Do NOT add, remove, duplicate, or relocate "
    "any object, structure, vehicle, person, sign, plant, or piece of "
    "equipment that is not already visible in the source image. Do NOT "
    "change the building's massing, proportions, layout, number of "
    "elements, or the camera's framing/angle/crop. The output must depict "
    "exactly the same scene and composition as the input image, just "
    "rendered with more realistic materials and lighting."
)


@lru_cache(maxsize=1)
def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        # Fails loudly at call time, not at import time — same reasoning as
        # app/ai/client.py's own _get_client for anthropic_api_key.
        raise HTTPException(status_code=503, detail="AI Concept Render is not configured (missing gemini_api_key)")
    return genai.Client(api_key=settings.gemini_api_key)


def presign_upload(content_type: str) -> tuple[str, str]:
    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, "capture.png")
    upload_url = object_storage.presigned_put_url(storage_key, content_type)
    return storage_key, upload_url


async def _generate(image_bytes: bytes, user_prompt: str) -> bytes:
    client = _get_client()
    prompt = GUARDRAIL_PROMPT if not user_prompt.strip() else f"{GUARDRAIL_PROMPT}\n\nAdditional instructions (materials/lighting/mood only — the rules above still apply): {user_prompt.strip()}"
    try:
        response = await client.aio.models.generate_content(
            model=MODEL,
            contents=[prompt, types.Part.from_bytes(data=image_bytes, mime_type="image/png")],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI Concept Render failed: {exc}") from exc
    for part in response.parts or []:
        if part.inline_data and part.inline_data.data:
            return part.inline_data.data
    raise HTTPException(status_code=502, detail="AI Concept Render returned no image")


# The browser has already PUT the raw capture straight to R2 via /presign
# by the time this runs (same shape as ai_upscale.py's own
# upscale_stored_image) — Gemini's own API takes real image bytes, not a
# URL it fetches itself the way fal.ai does, so this downloads once here
# rather than handing it a presigned url.
#
# also_upscale (2026-09-02, per Maro: "opportunity to build the generative
# then toggle the upscale to go through it all") — composes the two
# pipelines rather than duplicating either: Gemini's own output resolution
# is often smaller than the requested export size, so this just asks the
# existing fal.ai faithful-upscale pipeline to enlarge/sharpen the
# generated image afterward, reusing ai_upscale.upscale_stored_image
# directly rather than a second implementation of the same R2/fal.ai
# round-trip.
async def generate_concept_render(storage_key: str, user_prompt: str, also_upscale: bool) -> str:
    source_url = object_storage.presigned_get_url(storage_key)
    async with httpx.AsyncClient() as http:
        response = await http.get(source_url)
        response.raise_for_status()
        raw_bytes = response.content
    await run_in_threadpool(object_storage.delete_object, storage_key)

    generated_bytes = await _generate(raw_bytes, user_prompt)

    if also_upscale:
        intermediate_key = object_storage.generate_storage_key(ai_upscale.STORAGE_PREFIX, "concept.png")
        await run_in_threadpool(object_storage.upload_bytes, intermediate_key, generated_bytes, "image/png")
        return await ai_upscale.upscale_stored_image(intermediate_key)

    result_key = object_storage.generate_storage_key(STORAGE_PREFIX, "concept.png")
    await run_in_threadpool(object_storage.upload_bytes, result_key, generated_bytes, "image/png")
    return await run_in_threadpool(object_storage.presigned_get_url, result_key)
