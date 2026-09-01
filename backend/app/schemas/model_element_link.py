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


# Bulk link (2026-09-01, per Maro: "optimise and reduce waste, improve
# speed") — same "one request instead of N" fix as CollectionMemberBulkCreate
# (collection.py), for the same underlying reason: FourD.tsx's own "Bulk
# Link Selected to Activity" and Poe's own propose_link_elements approval
# both used to POST once per element. All elements here always share the
# same activity_id (a "link this whole selection to one activity" action
# has no reason to target more than one), so this only needs one Activity
# lookup for the whole batch, not one per element.
class ModelElementLinkBulkMember(BaseModel):
    source_kind: Literal["ifc", "mesh", "annotation", "ifc_split"]
    element_ref: str = Field(min_length=1, max_length=300)
    element_label: str = Field(min_length=1, max_length=300)


class ModelElementLinkBulkCreate(BaseModel):
    activity_id: uuid.UUID
    members: list[ModelElementLinkBulkMember]
    animation_profile_id: uuid.UUID | None = None


class ModelElementLinkBulkResponse(BaseModel):
    created: list[ModelElementLinkResponse]
    # Already-linked-to-this-activity elements are silently skipped, not
    # an error — same "benign no-op" precedent the old one-at-a-time 409
    # catch already established in FourD.tsx.
    skipped_duplicates: int
