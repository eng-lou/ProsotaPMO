from __future__ import annotations

import uuid
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.calendar import Calendar
from app.models.model_element_link import ModelElementLink
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.schemas.schedule_bulk_generate import ScheduleBulkGenerateRequest, ScheduleBulkGenerateResponse
from app.services import cost_sync, scheduling_cpm
from app.services.activity import _activity_role, _apply_computed_fields, _next_role_code, _recompute_hierarchy, _require_live_schedule_period
from app.services.scheduling_cpm import _find_cycle


# Persists a whole staged schedule (WBS + activities + resources +
# assignments + relationships + IFC links) from one payload the frontend
# already computed (frontend/src/modules/fourD/scheduleGeneration.ts) in a
# single transaction, with the CPM/hierarchy recompute deferred to run
# exactly once at the end — see this module's own import of
# _recompute_hierarchy/scheduling_cpm.recompute_schedule, the same pair
# create_activity calls per-row for a single edit, called here only after
# every row already exists (2026-07-13, per Maro's "generate a resource
# loaded schedule from an imported ifc" request — research confirmed no
# bulk-create path existed anywhere in this app before this, and every
# single-row create triggers its own full CPM pass, which a few-hundred-row
# generation absolutely should not repeat few-hundred times over).
#
# temp_id cross-references are resolved into real ids as each row is
# constructed (ids are assigned client-side in Python via uuid.uuid4(), not
# left to the DB, so a later row in the same payload can immediately
# reference an earlier one's real id without a flush round-trip in
# between) — parents are always inserted before children, since
# `activities` is walked in strict parent-before-child order below, not
# assumed to arrive pre-sorted from the frontend.
async def bulk_generate(db: AsyncSession, data: ScheduleBulkGenerateRequest) -> ScheduleBulkGenerateResponse:
    period = await _require_live_schedule_period(db, data.schedule_period_id)

    if data.calendar_id is not None:
        calendar = await db.get(Calendar, data.calendar_id)
        if calendar is None or calendar.project_id != data.project_id:
            raise HTTPException(status_code=422, detail="Unknown calendar_id for this project")

    activity_by_temp_id = {a.temp_id: a for a in data.activities}
    if len(activity_by_temp_id) != len(data.activities):
        raise HTTPException(status_code=422, detail="Duplicate activity temp_id in payload")

    children_by_parent_temp_id: dict[str | None, list[str]] = defaultdict(list)
    for a in data.activities:
        if a.parent_temp_id is not None and a.parent_temp_id not in activity_by_temp_id:
            raise HTTPException(status_code=422, detail=f"Unknown parent_temp_id '{a.parent_temp_id}'")
        children_by_parent_temp_id[a.parent_temp_id].append(a.temp_id)

    # --- Validation pass: every check below (structure, temp_id references,
    # relationship cycles) runs BEFORE a single db.add() happens anywhere in
    # this function. A rejected batch must leave the session completely
    # untouched — a would_create_cycle-style per-pair DB check triggers
    # autoflush of anything already added, and this function's tests share
    # one session across multiple requests (tests/conftest.py's `client`
    # fixture), so a mid-batch db.rollback() would expire ORM objects other
    # fixtures in the same test still depend on. Validating everything
    # up front sidesteps that entirely instead of working around it.
    real_id_by_temp_id: dict[str, uuid.UUID] = {}
    ordered_inserts: list[tuple[str, uuid.UUID | None, int]] = []  # (temp_id, parent_real_id, sort_order)

    def plan_activity(temp_id: str, parent_real_id: uuid.UUID | None, sort_order: int) -> None:
        activity_id = uuid.uuid4()
        real_id_by_temp_id[temp_id] = activity_id
        ordered_inserts.append((temp_id, parent_real_id, sort_order))
        for i, child_temp_id in enumerate(children_by_parent_temp_id.get(temp_id, [])):
            plan_activity(child_temp_id, activity_id, i)

    for i, temp_id in enumerate(children_by_parent_temp_id.get(None, [])):
        plan_activity(temp_id, None, i)

    if len(real_id_by_temp_id) != len(data.activities):
        raise HTTPException(status_code=422, detail="activities contains an unreachable/cyclic parent_temp_id chain")

    resource_real_id_by_temp_id: dict[str, uuid.UUID] = {r.temp_id: uuid.uuid4() for r in data.resources}

    activities_with_assignments: set[uuid.UUID] = set()
    for a in data.assignments:
        if a.activity_temp_id not in real_id_by_temp_id:
            raise HTTPException(status_code=422, detail=f"Unknown activity_temp_id '{a.activity_temp_id}' in assignments")
        if a.resource_temp_id not in resource_real_id_by_temp_id:
            raise HTTPException(status_code=422, detail=f"Unknown resource_temp_id '{a.resource_temp_id}' in assignments")
        resource = next(r for r in data.resources if r.temp_id == a.resource_temp_id)
        # Same rule resource_assignment.py's own _validate_assignment_fields
        # enforces for a single create — material has no sensible default
        # utilisation, a quantity must be given.
        if resource.resource_type == "material" and a.quantity is None:
            raise HTTPException(status_code=422, detail=f"quantity is required for material resource '{resource.name}'")
        activities_with_assignments.add(real_id_by_temp_id[a.activity_temp_id])

    # Relationship cycle check, done once in memory against the batch's own
    # candidate edges plus whatever already exists in this schedule period
    # (single read-only query — nothing has been added to the session yet,
    # so this can't trigger a premature autoflush) instead of
    # would_create_cycle's own per-pair DB round trip.
    existing_edges_result = await db.execute(
        select(ActivityRelationship.predecessor_id, ActivityRelationship.successor_id)
        .join(Activity, Activity.id == ActivityRelationship.predecessor_id)
        .where(Activity.schedule_period_id == data.schedule_period_id)
    )
    edges = list(existing_edges_result.all())
    relationship_edges: list[tuple[uuid.UUID, uuid.UUID]] = []
    for rel in data.relationships:
        if rel.predecessor_temp_id not in real_id_by_temp_id or rel.successor_temp_id not in real_id_by_temp_id:
            raise HTTPException(status_code=422, detail="Unknown predecessor/successor temp_id in relationships")
        predecessor_id = real_id_by_temp_id[rel.predecessor_temp_id]
        successor_id = real_id_by_temp_id[rel.successor_temp_id]
        edges.append((predecessor_id, successor_id))
        relationship_edges.append((predecessor_id, successor_id))
        node_ids = {n for edge in edges for n in edge}
        if _find_cycle(edges, node_ids):
            raise HTTPException(status_code=422, detail="Generated relationships would create a circular dependency")

    # --- Everything validated — now actually persist it.

    activities_by_real_id: dict[uuid.UUID, Activity] = {}
    for temp_id, parent_real_id, sort_order in ordered_inserts:
        staged = activity_by_temp_id[temp_id]
        role = _activity_role("task", parent_real_id)  # brand-new leaf; promotion to wbs_summary happens below
        code = await _next_role_code(db, data.project_id, role)
        activity_id = real_id_by_temp_id[temp_id]
        activity = Activity(
            id=activity_id,
            code=code, wbs_role=role,
            project_id=data.project_id, schedule_variant_id=period.schedule_variant_id,
            schedule_period_id=data.schedule_period_id,
            task_name=staged.task_name, activity_type="task", parent_id=parent_real_id, sort_order=sort_order,
            duration_hours=staged.duration_hours, calendar_id=data.calendar_id,
        )
        _apply_computed_fields(activity)
        db.add(activity)
        activities_by_real_id[activity_id] = activity

    for r in data.resources:
        db.add(Resource(
            id=resource_real_id_by_temp_id[r.temp_id], project_id=data.project_id, resource_type=r.resource_type,
            name=r.name, unit=r.unit, rate=r.rate, max_hours_per_day=r.max_hours_per_day,
        ))

    for a in data.assignments:
        db.add(ResourceAssignment(
            id=uuid.uuid4(), activity_id=real_id_by_temp_id[a.activity_temp_id],
            resource_id=resource_real_id_by_temp_id[a.resource_temp_id],
            utilisation_pct=a.utilisation_pct, quantity=a.quantity,
        ))

    for rel, (predecessor_id, successor_id) in zip(data.relationships, relationship_edges):
        db.add(ActivityRelationship(
            id=uuid.uuid4(), predecessor_id=predecessor_id, successor_id=successor_id,
            relationship_type=rel.relationship_type, lag_hours=rel.lag_hours,
        ))

    # --- ModelElementLink rows (IFC element_refs per activity)
    link_count = 0
    for staged in data.activities:
        if not staged.element_refs:
            continue
        activity_id = real_id_by_temp_id[staged.temp_id]
        for element_ref in staged.element_refs:
            db.add(ModelElementLink(
                id=uuid.uuid4(), project_id=data.project_id, activity_id=activity_id,
                source_kind="ifc", element_ref=element_ref, element_label=staged.task_name,
            ))
            link_count += 1

    await db.commit()

    # Same two-pass shape create_activity uses for a single edit (hierarchy
    # -> CPM -> hierarchy again, so any WBS summary's rolled-up start/
    # finish/duration reflects the CPM pass that just ran) — run exactly
    # once for this whole batch, not once per row.
    await _recompute_hierarchy(db, data.schedule_period_id)
    await scheduling_cpm.recompute_schedule(db, data.schedule_period_id)
    await _recompute_hierarchy(db, data.schedule_period_id)

    # Must run after the CPM pass above, not before: compute_assignment_budget
    # (resource_costing.py) prices a crew/labour/equipment assignment off
    # activity.duration_days, which is only populated once CPM has actually
    # run — cost_sync'ing right after insert would price everything off a
    # still-null duration_days and silently write a zero budget.
    for activity_id in activities_with_assignments:
        await cost_sync.sync_cost_element_from_resources(db, activity_id)

    # A real, reproduced bug (2026-07-13, per Maro's screenshot: the root
    # WBS's own rolled-up Start showed 2030, years after its own earliest
    # child). Confirmed directly against the real generated schedule
    # afterward: the underlying data and _recompute_hierarchy's own
    # aggregation logic were both already correct (a bare, unrelated extra
    # call to it — run manually, well after generation — immediately
    # produced the right root Start with no other change), and this
    # session's own AsyncSessionLocal already sets expire_on_commit=False,
    # ruling out the obvious "a later commit expired the just-computed
    # values" explanation. The true mechanism is still unexplained, but
    # this extra pass is cheap, idempotent, and empirically closes the gap
    # for a large (multi-hundred-activity, 3+ level) generated tree
    # specifically — small hand-built trees never showed this, which is
    # why it went uncaught until a real multi-storey, multi-phase
    # generation surfaced it. Worth real root-causing if it recurs after
    # this.
    await _recompute_hierarchy(db, data.schedule_period_id)

    return ScheduleBulkGenerateResponse(
        activity_count=len(data.activities),
        resource_count=len(data.resources),
        assignment_count=len(data.assignments),
        relationship_count=len(data.relationships),
        model_element_link_count=link_count,
        activity_ids_by_temp_id=real_id_by_temp_id,
    )
