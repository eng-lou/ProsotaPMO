from __future__ import annotations

from fastapi import APIRouter

from app.schemas.ai_concept_render import (
    ConceptRenderRequest, ConceptRenderResult, ConceptRenderUploadUrl, ConceptRenderUploadUrlRequest,
)
from app.services import ai_concept_render as svc

router = APIRouter(prefix="/ai/concept-render", tags=["ai"])


# Upload directly to storage before requesting a render.
@router.post("/presign", response_model=ConceptRenderUploadUrl)
async def presign_concept_render_upload(payload: ConceptRenderUploadUrlRequest) -> ConceptRenderUploadUrl:
    storage_key, upload_url = svc.presign_upload(payload.content_type)
    return ConceptRenderUploadUrl(storage_key=storage_key, upload_url=upload_url)


@router.post("/", response_model=ConceptRenderResult)
async def concept_render(payload: ConceptRenderRequest) -> ConceptRenderResult:
    download_url = await svc.generate_concept_render(payload.storage_key, payload.prompt, payload.creativity)
    return ConceptRenderResult(download_url=download_url)
