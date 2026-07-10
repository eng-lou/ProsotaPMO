from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CollectionMemberBase(BaseModel):
    source_kind: Literal["ifc", "mesh"]
    element_ref: str = Field(min_length=1, max_length=300)
    element_label: str = Field(min_length=1, max_length=300)


class CollectionMemberCreate(CollectionMemberBase):
    collection_id: uuid.UUID


class CollectionMemberResponse(CollectionMemberBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    collection_id: uuid.UUID
    created_at: datetime


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
