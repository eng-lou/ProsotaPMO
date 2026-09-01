from __future__ import annotations

from pydantic import BaseModel


class UpscaleUploadUrlRequest(BaseModel):
    content_type: str


class UpscaleUploadUrl(BaseModel):
    storage_key: str
    upload_url: str


class UpscaleImageRequest(BaseModel):
    storage_key: str


class UpscaleImageResult(BaseModel):
    download_url: str
