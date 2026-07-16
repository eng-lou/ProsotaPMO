from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.activity_relationship import RelationshipType
from app.schemas.resource import ResourceType


# One staged, already-computed schedule (2026-07-13, per Maro's "generate a
# resource loaded schedule from an imported ifc" request) — the frontend's
# IFC extraction/grouping/rate math (frontend/src/modules/fourD/
# scheduleGeneration.ts) already produced the whole plan; this endpoint's
# only job is persisting it in one transaction with one CPM pass at the end,
# not doing any of that domain math itself. Same "frontend computes,
# backend just persists" split Material Presets/Clash Detective already
# established this session.
#
# temp_id is a plain frontend-chosen string (never stored) used purely to
# express cross-references within this one payload — the response maps
# each temp_id to the real UUID it became, so the frontend can e.g.
# immediately select/highlight what it just created without a second
# round-trip.
class BulkActivityInput(BaseModel):
    temp_id: str
    task_name: str = Field(min_length=1, max_length=500)
    # None = top-level. Not required to be a real "WBS" node up front —
    # any node that ends up with children is auto-promoted to a WBS
    # summary by the existing _recompute_hierarchy pass (activity.py) once
    # everything's inserted, the identical mechanism a normal single
    # create_activity relies on; a leaf's own duration_hours is simply
    # ignored for a node that turns out to have children.
    parent_temp_id: str | None = None
    duration_hours: Decimal = Field(default=Decimal("0"), ge=0)
    # GlobalIds (source_kind="ifc") to link via ModelElementLink once this
    # activity has a real id — see model_element_link.py's own docstring
    # on why element_ref is a loose string, not a hard FK.
    element_refs: list[str] = []


class BulkResourceInput(BaseModel):
    temp_id: str
    name: str = Field(min_length=1, max_length=255)
    resource_type: ResourceType = "crew"
    unit: str = Field(min_length=1, max_length=50)
    rate: Decimal = Field(ge=0)
    max_hours_per_day: Decimal = Field(default=Decimal("8"), gt=0, le=24)


class BulkAssignmentInput(BaseModel):
    activity_temp_id: str
    resource_temp_id: str
    utilisation_pct: Decimal | None = Field(default=Decimal("100"), gt=0, le=100)
    quantity: Decimal | None = Field(default=None, gt=0)


class BulkRelationshipInput(BaseModel):
    predecessor_temp_id: str
    successor_temp_id: str
    relationship_type: RelationshipType = "FS"
    lag_hours: Decimal = Decimal("0")


class ScheduleBulkGenerateRequest(BaseModel):
    project_id: uuid.UUID
    schedule_period_id: uuid.UUID
    # Applied to every generated activity (2026-07-13, per Maro: "prompt the
    # user to pick the calendar they want... by default the standard
    # calendar") — one choice for the whole batch, not per-activity; None
    # means "inherit the project's own default calendar", the same fallback
    # Activity.calendar_id already means everywhere else in this app
    # (activity.py's own _CalendarLookup.resolve).
    calendar_id: uuid.UUID | None = None
    activities: list[BulkActivityInput] = []
    resources: list[BulkResourceInput] = []
    assignments: list[BulkAssignmentInput] = []
    relationships: list[BulkRelationshipInput] = []


class ScheduleBulkGenerateResponse(BaseModel):
    activity_count: int
    resource_count: int
    assignment_count: int
    relationship_count: int
    model_element_link_count: int
    # temp_id -> real Activity id, so the caller can immediately select/
    # frame what it just generated without a second fetch.
    activity_ids_by_temp_id: dict[str, uuid.UUID]
