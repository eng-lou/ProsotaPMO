from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ModelElementLinkBase(BaseModel):
    activity_id: uuid.UUID
    # "annotation" (2026-07-12) — element_ref is an Annotation row's own id,
    # see model_element_link.py's own docstring. "ifc_split" (2026-07-15) —
    # one level-slice of an element recorded in ElementSplit
    # (element_split.py); element_ref is that parent's GlobalId plus a
    # `::split:<index>` suffix, never a real IFC entity's own identity.
    source_kind: Literal["ifc", "mesh", "annotation", "ifc_split"]
    element_ref: str = Field(min_length=1, max_length=300)
    element_label: str = Field(min_length=1, max_length=300)


class ModelElementLinkCreate(ModelElementLinkBase):
    # Optional at create time too (2026-08-30, per Maro: "while i build
    # activity link, why cant i set the profile at the same time" — this
    # used to be create-then-a-separate-PATCH-to-set-profile only, since it
    # was the only field ModelElementLinkUpdate below ever needed to touch).
    # Still optional, still PATCH-able afterwards via ModelElementLinkUpdate
    # — this just also lets a caller who already knows which profile they
    # want skip the extra round trip.
    animation_profile_id: uuid.UUID | None = None


# Assigns/clears which saved AnimationProfile drives this element after the
# fact (2026-07-11, per Maro) — everything else in ModelElementLinkBase is
# fixed at link time (re-linking to a different activity/element is
# delete-then-recreate, not an edit); animation_profile_id is the one field
# both create (above) and update need.
class ModelElementLinkUpdate(BaseModel):
    animation_profile_id: uuid.UUID | None = None


class ModelElementLinkResponse(ModelElementLinkBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    animation_profile_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
