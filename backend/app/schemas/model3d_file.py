from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Model3DKind = Literal["ifc", "mesh"]
UpAxis = Literal["y", "z"]


class Model3DFileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    kind: Model3DKind
    source_up_axis: UpAxis
    size_bytes: int
    created_at: datetime
    updated_at: datetime
