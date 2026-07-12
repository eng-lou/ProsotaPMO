from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ClashResultPair(BaseModel):
    """One clashing pair as computed client-side, submitted in bulk to
    PUT /api/v1/clash-tests/{id}/results — see ClashResult's own docstring
    on why this is a replace, not a plain create."""

    element_a_source_kind: Literal["ifc", "mesh"]
    element_a_ref: str = Field(min_length=1, max_length=300)
    element_a_label: str = Field(min_length=1, max_length=300)
    element_b_source_kind: Literal["ifc", "mesh"]
    element_b_ref: str = Field(min_length=1, max_length=300)
    element_b_label: str = Field(min_length=1, max_length=300)
    distance_mm: float | None = None


class ClashResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    clash_test_id: uuid.UUID
    element_a_source_kind: Literal["ifc", "mesh"]
    element_a_ref: str
    element_a_label: str
    element_b_source_kind: Literal["ifc", "mesh"]
    element_b_ref: str
    element_b_label: str
    distance_mm: float | None
    status: Literal["new", "reviewed", "approved"]
    comment: str | None
    created_at: datetime
    updated_at: datetime


class ClashResultUpdate(BaseModel):
    status: Literal["new", "reviewed", "approved"] | None = None
    comment: str | None = None


class ClashTestBase(BaseModel):
    name: str = Field(min_length=1, max_length=200, default="Clash Test")
    group_a_collection_id: uuid.UUID
    group_b_collection_id: uuid.UUID
    test_type: Literal["hard", "clearance"] = "hard"
    tolerance_mm: float = 0.0


class ClashTestCreate(ClashTestBase):
    project_id: uuid.UUID


class ClashTestUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    group_a_collection_id: uuid.UUID | None = None
    group_b_collection_id: uuid.UUID | None = None
    test_type: Literal["hard", "clearance"] | None = None
    tolerance_mm: float | None = None


class ClashTestResponse(ClashTestBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    last_run_at: datetime | None
    created_at: datetime
    updated_at: datetime
    results: list[ClashResultResponse] = []
