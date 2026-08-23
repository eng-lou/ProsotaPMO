from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FourDVideoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    duration_sec: float
    size_bytes: int
    created_at: datetime
    updated_at: datetime


# Direct-to-R2 upload (2026-08-23) — see model3d_file.py's own
# PresignedUploadRequest/PresignedUpload for the shared shape/reasoning
# (Vercel's hard 4.5MB Function request-body cap).
class PresignedUploadRequest(BaseModel):
    content_type: str


class PresignedUpload(BaseModel):
    storage_key: str
    upload_url: str


class FourDVideoCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    duration_sec: float
    storage_key: str
