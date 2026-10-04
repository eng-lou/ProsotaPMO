from __future__ import annotations

from functools import lru_cache
import base64
import binascii

import httpx
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from google import genai
from google.genai import types

from app.core.config import settings
from app.ai.openai_transport import post_openai
from app.services import object_storage

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

# Creativity is prompt guidance, not a provider temperature or geometry guarantee.
GUARDRAIL_PROMPT = (
    "Create an architectural visualization from the supplied capture. "
    "Keep the camera angle, framing, building massing, proportions, layout and "
    "visible structural elements aligned with the source. Do not invent or "
    "remove buildings, floors or equipment. Treat the user's prompt as art "
    "direction within these constraints. Return only the rendered image."
)


def build_render_prompt(user_prompt: str, creativity: float) -> str:
    if not 0 <= creativity <= 1:
        raise ValueError('Creativity must be between 0 and 1')
    if creativity <= 0.25:
        direction = (
            "Prioritize close source alignment. Retouch existing surfaces and lighting "
            "subtly, preserve material colours and visible details, and add no objects."
        )
    elif creativity <= 0.65:
        direction = (
            "Balance source alignment with creative presentation. Explore realistic "
            "material finishes, richer textures, lighting and mood while preserving "
            "all objects and the original composition."
        )
    else:
        direction = (
            "Allow adventurous material palettes, lighting, atmosphere and artistic "
            "styling. Follow requested decorative changes, but preserve the source "
            "architecture and camera; do not add unrequested scene objects."
        )
    return (
        f"{GUARDRAIL_PROMPT}\n\nCreativity: {creativity:.2f} on a 0 to 1 scale "
        f"(0 = closest source alignment; 1 = strongest creative interpretation). "
        f"Scale the strength of the treatment to this value. {direction}"
        + (f"\n\nUser art direction: {user_prompt.strip()}" if user_prompt.strip() else "")
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


async def _generate(image_bytes: bytes, user_prompt: str, creativity: float = 0.2) -> bytes:
    prompt = build_render_prompt(user_prompt, creativity)
    if settings.ai_concept_render_provider == 'openai' or (settings.ai_concept_render_provider == 'auto' and settings.openai_api_key):
        response = await post_openai('images/edits', timeout=240,
            data={'model': settings.openai_image_model, 'prompt': prompt, 'n': '1',
                  'quality': 'high', 'size': 'auto', 'output_format': 'png'},
            files={'image': ('capture.png', image_bytes, 'image/png')},
        )
        try:
            image = base64.b64decode(response['data'][0]['b64_json'], validate=True)
            if not image:
                raise ValueError('Empty image')
            return image
        except (KeyError, IndexError, TypeError, ValueError, binascii.Error) as exc:
            raise HTTPException(502, 'OpenAI Concept Render returned no valid image.') from exc
    client = _get_client()
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


# The capture is already in object storage; fetch once for the image edit.
async def generate_concept_render(storage_key: str, user_prompt: str, creativity: float = 0.2) -> str:
    source_url = object_storage.presigned_get_url(storage_key)
    async with httpx.AsyncClient() as http:
        response = await http.get(source_url)
        response.raise_for_status()
        raw_bytes = response.content
    await run_in_threadpool(object_storage.delete_object, storage_key)

    generated_bytes = await _generate(raw_bytes, user_prompt, creativity)

    result_key = object_storage.generate_storage_key(STORAGE_PREFIX, "concept.png")
    await run_in_threadpool(object_storage.upload_bytes, result_key, generated_bytes, "image/png")
    return await run_in_threadpool(object_storage.presigned_get_url, result_key)
