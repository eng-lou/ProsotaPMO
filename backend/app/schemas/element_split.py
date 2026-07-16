from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ElementSplitBase(BaseModel):
    source_kind: Literal["ifc"]
    element_ref: str = Field(min_length=1, max_length=300)
    # In metres, already converted from the source file's own declared unit
    # (frontend's own getLengthUnitToMetres) — this table never needs to
    # know a file's unit system. At least one cut, or there's no split.
    cut_elevations_m: list[float] = Field(min_length=1)


class ElementSplitCreate(ElementSplitBase):
    project_id: uuid.UUID


# Re-splitting an already-split element (add/remove a cut) replaces the
# whole list rather than editing individual entries — same "one unit,
# owned by whoever writes it" shape AnimationProfile.config uses.
class ElementSplitUpdate(BaseModel):
    cut_elevations_m: list[float] = Field(min_length=1)


class ElementSplitResponse(ElementSplitBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
