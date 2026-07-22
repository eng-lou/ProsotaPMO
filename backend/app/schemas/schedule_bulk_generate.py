from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Literal

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
    # "task" default — a generated Project Milestones folder's own
    # Construction Start/Substantial Completion children (2026-07-17, per
    # Maro) are the only callers that ever set this to start_milestone/
    # finish_milestone; every other generated row stays a plain task (WBS
    # summary promotion still happens automatically via _recompute_hierarchy
    # once inserted, same as before — this field doesn't affect that).
    # wbs_summary is deliberately not offered here — same "server-computed,
    # never client-chosen" rule a normal create_activity already enforces.
    activity_type: Literal["task", "start_milestone", "finish_milestone"] = "task"
    # GlobalIds (source_kind="ifc") to link via ModelElementLink once this
    # activity has a real id — see model_element_link.py's own docstring
    # on why element_ref is a loose string, not a hard FK.
    element_refs: list[str] = []
    # Same order/length as element_refs (2026-07-22, per Maro: "another
    # column to see the dropdown of 3d elements assigned so i browse down
    # the list" — see bulk_generate's own ModelElementLink write below for
    # why this matters: without a real per-element label, every one of a
    # generation's ModelElementLink rows fell back to this activity's own
    # task_name, so a browse-the-elements UI built on top of that would
    # have shown the identical string N times over). Optional/empty for
    # any caller that genuinely has nothing better — falls back to
    # task_name per element exactly as before, not a hard requirement.
    element_labels: list[str] = []
    # Which ScheduleCategory/CategoryPhase (frontend's own
    # ifcScheduleExtraction.ts/scheduleGeneration.ts) this activity was
    # generated as — None for a synthetic WBS/root/closeout node (see
    # Activity.schedule_category's own docstring for why this is persisted
    # at all: a later, separate resource-generation pass needs it).
    category: str | None = Field(default=None, max_length=100)
    phase_key: str | None = Field(default=None, max_length=100)
    # The real IFC-measured quantity duration_hours was computed from
    # (2026-07-18, per Maro's own QA — see Activity.schedule_quantity's own
    # model docstring: BOQ generation used to have to reverse-engineer this
    # from duration_hours, recovering the rounded-up day count rather than
    # the true measured number). Same null-for-non-generated-activities
    # contract as category/phase_key above.
    quantity: Decimal | None = Field(default=None, ge=0)
    # Coarser than category — "Structural"/"Architectural"/"Mechanical"/
    # "Plumbing"/"Electrical"/"Site & Landscaping" (2026-07-17, per Maro:
    # "create a udf column called Discipline... so i can also choose to
    # group by discipline") — written into a "Discipline" UDF value on this
    # activity (see bulk_generate's own handling below), not a new Activity
    # column the way schedule_category/schedule_phase_key are: this is
    # meant to be a normal, user-visible/user-editable grid column from day
    # one (UDFs already support grouping/filtering in the Scheduling grid),
    # where schedule_category/schedule_phase_key are purely internal,
    # never-shown bookkeeping for the later resource-generation pass.
    discipline: str | None = Field(default=None, max_length=100)


class BulkResourceInput(BaseModel):
    temp_id: str
    name: str = Field(min_length=1, max_length=255)
    resource_type: ResourceType = "crew"
    unit: str = Field(min_length=1, max_length=50)
    rate: Decimal = Field(ge=0)
    max_hours_per_day: Decimal = Field(default=Decimal("8"), gt=0, le=24)


class BulkAssignmentInput(BaseModel):
    # Exactly one of these two must be set (enforced in the service, not
    # here — Pydantic's field-level validation can't easily express
    # "exactly one of"). activity_temp_id targets a brand-new activity
    # created in this same payload's own `activities` list (the original,
    # "generate a whole new schedule" use). activity_id (2026-07-17, per
    # Maro's "Generate Resources"/"Auto Assign Resources" as a separate,
    # later Resources-tab action against an already-committed IFC-generated
    # schedule) instead targets a real, already-existing Activity — this
    # payload's own `activities` can be empty in that case, since there's
    # nothing new to create, only resources/assignments against work that
    # already exists.
    activity_temp_id: str | None = None
    activity_id: uuid.UUID | None = None
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
    # Both 2026-07-17, per Maro — support the Resources tab's own "Generate
    # Resources" (repeatable: adding more IFC-generated activities later and
    # re-running shouldn't spawn duplicate crew/equipment rows for a name
    # that's already in the pool) and "Auto Assign Resources" (repeatable:
    # re-running after new activities were linked shouldn't re-assign, and
    # re-duplicate the cost of, work that already has its resource). Both
    # default False so the original "generate a whole new schedule" path
    # (fresh project, nothing to dedupe against yet) is unaffected.
    dedupe_resources_by_name: bool = False
    skip_existing_assignments: bool = False


class ScheduleBulkGenerateResponse(BaseModel):
    activity_count: int
    # Actually-inserted new Resource rows — with dedupe_resources_by_name,
    # this can be less than len(request.resources) whenever a name already
    # existed in the pool and was reused instead (2026-07-17).
    resource_count: int
    # Actually-inserted new ResourceAssignment rows — with
    # skip_existing_assignments, this can be less than
    # len(request.assignments) whenever that (activity, resource) pairing
    # already had one (2026-07-17).
    assignment_count: int
    relationship_count: int
    model_element_link_count: int
    # temp_id -> real Activity id, so the caller can immediately select/
    # frame what it just generated without a second fetch.
    activity_ids_by_temp_id: dict[str, uuid.UUID]
    # temp_id -> real Resource id — either newly created, or the existing
    # row dedupe_resources_by_name matched by name (2026-07-17, per Maro's
    # "Generate Resources"/"Auto Assign Resources" flow) — lets the caller
    # resolve its own resource_temp_id references without a second fetch,
    # same convenience activity_ids_by_temp_id already provides.
    resource_ids_by_temp_id: dict[str, uuid.UUID]
