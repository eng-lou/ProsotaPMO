from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

SiteCaptureKind = Literal["xyz", "e57"]
UpAxis = Literal["y", "z"]


class SiteCaptureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    captured_at: date
    kind: SiteCaptureKind
    source_up_axis: UpAxis
    size_bytes: int
    force_visible: bool
    created_at: datetime
    updated_at: datetime


# Metadata-only edits (rename, redate, toggle force_visible) — re-uploading
# a replacement scan is a new capture, not a PATCH, same reasoning
# Model3DFile's own re-import-by-name-replaces-not-appends convention
# applies at the *upload* step, not here: a capture's captured_at is part
# of its own identity (which dated scan is this), so there is no single
# "the current version of this capture" to overwrite in place.
class SiteCaptureUpdate(BaseModel):
    name: str | None = None
    captured_at: date | None = None
    force_visible: bool | None = None


# Direct-to-R2 upload (2026-08-23) — see model3d_file.py's own
# PresignedUploadRequest/PresignedUpload for the shared shape/reasoning
# (Vercel's hard 4.5MB Function request-body cap); site_capture.py has its
# own copy rather than importing model3d_file.py's, since the two schema
# modules are otherwise independent and this is a tiny, stable shape.
class PresignedUploadRequest(BaseModel):
    name: str
    content_type: str


class PresignedUpload(BaseModel):
    storage_key: str
    upload_url: str


class SiteCaptureCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    captured_at: date
    kind: SiteCaptureKind = "xyz"
    source_up_axis: UpAxis
    storage_key: str
