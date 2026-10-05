from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core.config import settings

from app.schemas.ai_attachment import AiAttachmentPresign, AiAttachmentPresignRequest
from app.services import object_storage

router = APIRouter(prefix="/ai/attachments", tags=["ai"])

STORAGE_PREFIX = "ai-attachments"


# Step 1 of the direct-to-R2 upload (2026-08-31) — same pattern as
# model3d_files.py's own /presign (see object_storage.py's own header for
# the Vercel 4.5MB body-cap reason). The browser PUTs the file's own bytes
# straight to the returned url, then embeds storage_key directly into the
# chat message's own content block — see aiAssistant.ts's own header and
# orchestrator.py's storage-key-expansion step, which resolves it back to a
# real, freshly-presigned GET url immediately before every single Anthropic
# call (never once at upload time), so the url embedded in a resent
# message never has a chance to go stale no matter how long the
# conversation runs.
@router.post("/presign", response_model=AiAttachmentPresign)
async def presign_attachment(payload: AiAttachmentPresignRequest) -> AiAttachmentPresign:
    document_types = {
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
    content_type = document_types.get(Path(payload.name).suffix.lower(), payload.content_type)
    uses_openai = settings.ai_provider == 'openai' or (settings.ai_provider == 'auto' and bool(settings.openai_api_key))
    if content_type in (document_types['.doc'], document_types['.docx']) and not uses_openai:
        raise HTTPException(400, 'Word attachments require the OpenAI provider. Save the document as PDF for the current provider.')
    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, payload.name)
    upload_url = object_storage.presigned_put_url(storage_key, content_type)
    return AiAttachmentPresign(storage_key=storage_key, upload_url=upload_url)
