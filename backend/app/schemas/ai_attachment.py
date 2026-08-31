from __future__ import annotations

from pydantic import BaseModel

# Chat attachment presign (2026-08-31) — same "browser uploads straight to
# R2, backend never sees the bytes" shape as model3d_file.py/site_capture.py/
# fourd_video.py's own PresignedUploadRequest/PresignedUpload (see
# object_storage.py's own header for the Vercel 4.5MB body-cap reason all
# four exist for). No "step 2" create-record call the way those have —
# unlike a Model3DFile/SiteCapture, a chat attachment isn't a standing
# project resource with its own row; the storage_key is only ever embedded
# directly into that one chat message's own content block (see
# orchestrator.py's own storage-key-expansion step), nothing more to record.
class AiAttachmentPresignRequest(BaseModel):
    name: str
    content_type: str


class AiAttachmentPresign(BaseModel):
    storage_key: str
    upload_url: str
