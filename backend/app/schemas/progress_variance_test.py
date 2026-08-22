from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ProgressVarianceResultElement(BaseModel):
    """One Group A element's density-query outcome as computed client-side,
    submitted in bulk to PUT /api/v1/progress-variance-tests/{id}/results —
    see ProgressVarianceResult's own docstring on why this is a replace,
    not a plain create."""

    element_source_kind: Literal["ifc", "mesh"]
    element_ref: str = Field(min_length=1, max_length=300)
    element_label: str = Field(min_length=1, max_length=300)
    point_count: int = Field(ge=0)
    coverage_percent: float = Field(ge=0, le=100)
    confirmed_in_scan: bool


class ProgressVarianceResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    progress_variance_test_id: uuid.UUID
    element_source_kind: Literal["ifc", "mesh"]
    element_ref: str
    element_label: str
    point_count: int
    coverage_percent: float
    confirmed_in_scan: bool
    status: Literal["new", "reviewed", "approved"]
    comment: str | None
    created_at: datetime
    updated_at: datetime


class ProgressVarianceResultUpdate(BaseModel):
    status: Literal["new", "reviewed", "approved"] | None = None
    comment: str | None = None


class ProgressVarianceTestBase(BaseModel):
    name: str = Field(min_length=1, max_length=200, default="Progress Variance Test")
    group_a_collection_id: uuid.UUID
    site_capture_id: uuid.UUID
    min_coverage_percent: float = Field(default=50.0, ge=0, le=100)


class ProgressVarianceTestCreate(ProgressVarianceTestBase):
    project_id: uuid.UUID


class ProgressVarianceTestUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    group_a_collection_id: uuid.UUID | None = None
    site_capture_id: uuid.UUID | None = None
    min_coverage_percent: float | None = Field(default=None, ge=0, le=100)


class ProgressVarianceTestResponse(ProgressVarianceTestBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    last_run_at: datetime | None
    created_at: datetime
    updated_at: datetime
    results: list[ProgressVarianceResultResponse] = []


# Rolls a test's own per-element coverage_percent results up to whichever
# Activity(s) each element is separately linked to via ModelElementLink
# (2026-08-21, per Maro: "I would like for some correlation/association
# instead of trying to build a fresh ifc" — reuse the as-planned IFC's own
# elements + the schedule's own existing links to them, don't reconstruct
# anything). Not persisted anywhere — a read-only computed view over this
# test's latest run, presented for review; applying a suggestion is a
# plain PATCH against the existing activities endpoint's own
# pct_complete field (see activities.py), not a new write path here.
class ActivityProgressSuggestion(BaseModel):
    activity_id: uuid.UUID
    activity_code: str
    activity_name: str
    current_pct_complete: Decimal | None
    scan_suggested_pct_complete: float
    # Every element linked to this Activity via ModelElementLink, not just
    # the ones this particular test's Group A happened to include — lets
    # the reviewer see "2 of 5 linked elements were actually scanned" and
    # judge how much of the activity's real scope the suggestion covers.
    linked_element_count: int
    matched_element_count: int
