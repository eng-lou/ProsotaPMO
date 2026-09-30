from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

# The six PBR slots a preset can carry — mirrors frontend/src/modules/
# fourD/customTextures.ts's own TextureSlot union exactly.
MaterialPresetSlot = Literal["map", "metalnessMap", "roughnessMap", "normalMap", "aoMap", "displacementMap"]


class MaterialPresetTextureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slot: MaterialPresetSlot
    name: str


class MaterialPresetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    textures: list[MaterialPresetTextureResponse] = []
    created_at: datetime
    updated_at: datetime


# Direct-to-R2 texture upload (2026-09-30) — textures used to arrive as
# multipart files through this backend's own request body, which Vercel caps
# at 4.5MB, so any real high-res map failed to save in production. The
# browser now PUTs each file to a presigned url from /presign first and
# create/update only carry the resulting storage keys, same flow as
# model3d_file.py's own create_file.
class MaterialPresetTextureUpload(BaseModel):
    storage_key: str
    name: str


class MaterialPresetCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    textures: dict[MaterialPresetSlot, MaterialPresetTextureUpload] = {}


# A slot in neither `textures` nor `cleared_slots` is left untouched, so
# renaming a preset never re-uploads its existing textures.
class MaterialPresetUpdate(BaseModel):
    name: str
    textures: dict[MaterialPresetSlot, MaterialPresetTextureUpload] = {}
    cleared_slots: list[MaterialPresetSlot] = []
