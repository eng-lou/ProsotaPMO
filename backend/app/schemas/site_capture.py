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
