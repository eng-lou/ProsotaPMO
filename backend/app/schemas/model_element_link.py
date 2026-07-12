from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ModelElementLinkBase(BaseModel):
    activity_id: uuid.UUID
    # "annotation" (2026-07-12) — element_ref is an Annotation row's own id,
    # see model_element_link.py's own docstring.
    source_kind: Literal["ifc", "mesh", "annotation"]
    element_ref: str = Field(min_length=1, max_length=300)
    element_label: str = Field(min_length=1, max_length=300)


class ModelElementLinkCreate(ModelElementLinkBase):
    pass


# Assigns/clears which saved AnimationProfile drives this element (2026-07-11,
# per Maro) — the only thing about a link worth changing after creation;
# everything else in ModelElementLinkBase is fixed at link time (re-linking
# to a different activity/element is delete-then-recreate, not an edit).
class ModelElementLinkUpdate(BaseModel):
    animation_profile_id: uuid.UUID | None = None


class ModelElementLinkResponse(ModelElementLinkBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    animation_profile_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
