from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MaterialTextureSlot(BaseModel):
    # The uploaded image re-encoded client-side as a base64 data: URI —
    # directly usable as a THREE.TextureLoader source, no separate
    # file-serving endpoint (see material_preset.py's own model docstring).
    data_uri: str
    name: str


class MaterialPresetConfig(BaseModel):
    map: MaterialTextureSlot | None = None
    metalnessMap: MaterialTextureSlot | None = None
    roughnessMap: MaterialTextureSlot | None = None
    normalMap: MaterialTextureSlot | None = None
    # 2026-07-11, per Maro: AO + Displacement joining the existing 4 slots.
    # Safe to add as plain optional fields, no migration — config is stored
    # as JSONB (see this module's own docstring/model), so an existing
    # preset saved before this change simply has no aoMap/displacementMap
    # keys at all, and Pydantic defaults both to None on load rather than
    # erroring.
    aoMap: MaterialTextureSlot | None = None
    displacementMap: MaterialTextureSlot | None = None


class MaterialPresetCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    config: MaterialPresetConfig = MaterialPresetConfig()


class MaterialPresetUpdate(BaseModel):
    name: str
    config: MaterialPresetConfig = MaterialPresetConfig()


class MaterialPresetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    config: MaterialPresetConfig
    created_at: datetime
    updated_at: datetime
