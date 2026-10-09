from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ElementMetadata(BaseModel):
    model: str = Field(default="", max_length=300)
    type: str = Field(default="", max_length=100)
    level: str = Field(default="", max_length=300)


class PairMetadata(BaseModel):
    a: ElementMetadata | None = None
    b: ElementMetadata | None = None


class ClashResultPair(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    """One clashing pair as computed client-side, submitted in bulk to
    PUT /api/v1/clash-tests/{id}/results — see ClashResult's own docstring
    on why this is a replace, not a plain create."""

    element_a_source_kind: Literal["ifc", "mesh"]
    element_a_ref: str = Field(min_length=1, max_length=300)
    element_a_label: str = Field(min_length=1, max_length=300)
    element_b_source_kind: Literal["ifc", "mesh"]
    element_b_ref: str = Field(min_length=1, max_length=300)
    element_b_label: str = Field(min_length=1, max_length=300)
    element_metadata: PairMetadata = Field(default_factory=PairMetadata)
    clash_point: tuple[float, float, float] | None = None
    distance_mm: float | None = Field(default=None, ge=0, allow_inf_nan=False)


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
    element_metadata: PairMetadata = Field(default_factory=PairMetadata)
    clash_point: tuple[float, float, float] | None = None
    distance_mm: float | None
    status: Literal["new", "active", "reviewed", "approved", "resolved", "reopened"]
    comment: str | None
    issue_id: uuid.UUID | None = None
    review_history: list[dict] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ClashResultUpdate(BaseModel):
    status: Literal["new", "active", "reviewed", "approved", "resolved", "reopened"] | None = None
    comment: str | None = Field(default=None, max_length=4000)


class ClashTestBase(BaseModel):
    name: str = Field(min_length=1, max_length=200, default="Clash Test")
    group_a_collection_id: uuid.UUID
    group_b_collection_id: uuid.UUID
    test_type: Literal["hard", "clearance"] = "hard"
    tolerance_mm: float = Field(default=0, ge=0, le=1000000, allow_inf_nan=False)


class ClashTestCreate(ClashTestBase):
    project_id: uuid.UUID


class ClashTestUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    group_a_collection_id: uuid.UUID | None = None
    group_b_collection_id: uuid.UUID | None = None
    test_type: Literal["hard", "clearance"] | None = None
    tolerance_mm: float | None = Field(default=None, ge=0, le=1000000, allow_inf_nan=False)


class ClashTestResponse(ClashTestBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    last_run_at: datetime | None
    created_at: datetime
    updated_at: datetime
    results: list[ClashResultResponse] = []
