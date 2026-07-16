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
