from __future__ import annotations

from pydantic import BaseModel


class ConceptRenderUploadUrlRequest(BaseModel):
    content_type: str


class ConceptRenderUploadUrl(BaseModel):
    storage_key: str
    upload_url: str


class ConceptRenderRequest(BaseModel):
    storage_key: str
    # Optional, additive on top of ai_concept_render.py's own always-on
    # guardrail prompt — never a replacement for it (see that module's own
    # header on why).
    prompt: str = ""
    also_upscale: bool = False


class ConceptRenderResult(BaseModel):
    download_url: str
