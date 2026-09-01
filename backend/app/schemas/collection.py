from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CollectionMemberBase(BaseModel):
    # "ifc_split" (2026-07-15) — one level-slice of a split element, see
    # ModelElementLinkBase's own comment in model_element_link.py for the
    # identity shape.
    source_kind: Literal["ifc", "mesh", "ifc_split"]
    element_ref: str = Field(min_length=1, max_length=300)
    element_label: str = Field(min_length=1, max_length=300)


class CollectionMemberCreate(CollectionMemberBase):
    collection_id: uuid.UUID


class CollectionMemberResponse(CollectionMemberBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    collection_id: uuid.UUID
    created_at: datetime


# Bulk add (2026-09-01, per Maro: "optimise and reduce waste, improve
# speed... adding selected elements to a collection... took too long") —
# the frontend's own "Add Selected to Collection" (and Poe's own
# propose_clash_test approval, and "Bulk Link Selected to Activity" for
# ModelElementLink's own equivalent gap) previously called POST
# /collection-members/ once per element: for a large selection, that's N
# separate HTTP round trips AND N separate commits, each individually
# slow regardless of how fast any single one is. This takes the whole
# batch in one request, one duplicate check, one insert, one commit.
class CollectionMemberBulkCreate(BaseModel):
    collection_id: uuid.UUID
    members: list[CollectionMemberBase]


class CollectionMemberBulkResponse(BaseModel):
    created: list[CollectionMemberResponse]
    # Already-in-this-collection elements are silently skipped, not an
    # error — same "benign no-op, not worth surfacing per-element"
    # precedent the old one-at-a-time 409-catching loop already
    # established in FourD.tsx.
    skipped_duplicates: int


class CollectionBase(BaseModel):
    name: str = Field(min_length=1, max_length=200, default="Collection")
    parent_collection_id: uuid.UUID | None = None


class CollectionCreate(CollectionBase):
    project_id: uuid.UUID


class CollectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    parent_collection_id: uuid.UUID | None = None


class CollectionResponse(CollectionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    sort_order: int | None
    created_at: datetime
    updated_at: datetime
    members: list[CollectionMemberResponse] = []
