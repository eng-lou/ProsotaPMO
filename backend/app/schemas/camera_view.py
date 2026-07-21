from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CameraViewportState(BaseModel):
    """Everything about "what the viewport looked like" beyond the camera's
    own position/target (2026-07-20, per Maro: isolate just the columns,
    click a clash result, add an annotation, save the view — restoring it
    later should reproduce that exactly, not just jump the camera).
    Mirrors FourD.tsx's own visibility state field-for-field — the same 5
    pieces its existing handleShowAll reset already clears together
    (isolateMode/isolatedObjectIds/isolatedExpressIds/hiddenIds/
    hiddenExpressIds), plus isolated_ifc_model_id (isolatedExpressIds is
    implicitly scoped to whichever IFC model was active — see that state's
    own declaration comment in FourD.tsx) and show_clash_colors (the
    viewerSettings toggle that actually renders the clash-red tint —
    without it, a restored view could isolate the right pair but show no
    red). Annotations are deliberately NOT captured here — they're
    project-wide persistent markers (see annotation.py), unaffected by
    which camera view is active."""

    isolate_mode: bool
    isolated_object_ids: list[str] = []
    isolated_express_ids: list[int] = []
    isolated_ifc_model_id: str | None = None
    hidden_ids: list[str] = []
    hidden_express_ids: list[str] = []
    show_clash_colors: bool = False


class CameraViewBase(BaseModel):
    name: str = Field(default="Camera View", min_length=1, max_length=300)
    position_x: float
    position_y: float
    position_z: float
    target_x: float
    target_y: float
    target_z: float


class CameraViewCreate(CameraViewBase):
    project_id: uuid.UUID
    viewport_state: CameraViewportState | None = None
    # Base64 data URI (e.g. "data:image/png;base64,...") — see camera_view.py's
    # own docstring for why this is a plain column, not disk/blob storage.
    thumbnail_data_url: str | None = None


class CameraViewUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    position_x: float | None = None
    position_y: float | None = None
    position_z: float | None = None
    target_x: float | None = None
    target_y: float | None = None
    target_z: float | None = None
    viewport_state: CameraViewportState | None = None
    thumbnail_data_url: str | None = None


class CameraViewResponse(CameraViewBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    viewport_state: CameraViewportState | None = None
    thumbnail_data_url: str | None = None
