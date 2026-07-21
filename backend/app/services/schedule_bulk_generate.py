from __future__ import annotations

import uuid
from collections import Counter, defaultdict

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.calendar import Calendar
from app.models.model_element_link import ModelElementLink
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.user_defined_field import UserDefinedFieldDefinition, UserDefinedFieldValue
from app.schemas.schedule_bulk_generate import BulkAssignmentInput, ScheduleBulkGenerateRequest, ScheduleBulkGenerateResponse
from app.services import cost_sync, scheduling_cpm
from app.services.activity import _activity_role, _apply_computed_fields, _next_role_codes_batch, _recompute_hierarchy, _require_live_schedule_period
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

    # dedupe_resources_by_name (2026-07-17, per Maro — "Generate Resources"
    # being repeatable): reuse an existing Resource's real id by (project_id,
    # name) instead of minting a fresh row for a temp_id whose name is
    # already in the pool. One query up front for every candidate name,
    # rather than one query per resource.
    resource_real_id_by_temp_id: dict[str, uuid.UUID] = {}
    new_resource_temp_ids: set[str] = set(r.temp_id for r in data.resources)
    if data.dedupe_resources_by_name and data.resources:
        existing_by_name_result = await db.execute(
            select(Resource.name, Resource.id).where(
                Resource.project_id == data.project_id,
                Resource.name.in_({r.name for r in data.resources}),
            )
        )
        existing_id_by_name = dict(existing_by_name_result.all())
        for r in data.resources:
            existing_id = existing_id_by_name.get(r.name)
            if existing_id is not None:
                resource_real_id_by_temp_id[r.temp_id] = existing_id
                new_resource_temp_ids.discard(r.temp_id)
    for temp_id in new_resource_temp_ids:
        resource_real_id_by_temp_id[temp_id] = uuid.uuid4()

    # activity_id-targeted assignments (2026-07-17, per Maro — "Auto Assign
    # Resources" against an already-committed schedule, no new activities in
    # this same payload at all) — validated in one batched query against
    # this same schedule period, same reasoning as the temp_id path: never
    # let an assignment silently attach to an activity outside this project/
    # period, or one that doesn't exist at all.
    external_activity_ids = {a.activity_id for a in data.assignments if a.activity_id is not None}
    if external_activity_ids:
        existing_activities_result = await db.execute(
            select(Activity.id).where(
                Activity.id.in_(external_activity_ids), Activity.schedule_period_id == data.schedule_period_id,
            )
        )
        existing_activity_ids = {row[0] for row in existing_activities_result.all()}
        missing_activity_ids = external_activity_ids - existing_activity_ids
        if missing_activity_ids:
            raise HTTPException(status_code=422, detail=f"Unknown activity_id(s) in assignments: {sorted(str(m) for m in missing_activity_ids)}")

    resolved_activity_id_by_assignment: dict[int, uuid.UUID] = {}
    for i, a in enumerate(data.assignments):
        if a.activity_id is not None:
            resolved_activity_id_by_assignment[i] = a.activity_id
        elif a.activity_temp_id is not None:
            if a.activity_temp_id not in real_id_by_temp_id:
                raise HTTPException(status_code=422, detail=f"Unknown activity_temp_id '{a.activity_temp_id}' in assignments")
            resolved_activity_id_by_assignment[i] = real_id_by_temp_id[a.activity_temp_id]
        else:
            raise HTTPException(status_code=422, detail="Each assignment needs either activity_temp_id or activity_id")
        if a.resource_temp_id not in resource_real_id_by_temp_id:
            raise HTTPException(status_code=422, detail=f"Unknown resource_temp_id '{a.resource_temp_id}' in assignments")

    # skip_existing_assignments (2026-07-17, per Maro — "Auto Assign
    # Resources" being repeatable without duplicating cost for work that
    # already has its resource attached) — one batched query for every
    # (activity, resource) pair this payload is about to write, rather than
    # one query per assignment.
    already_assigned_pairs: set[tuple[uuid.UUID, uuid.UUID]] = set()
    if data.skip_existing_assignments and data.assignments:
        candidate_activity_ids = {resolved_activity_id_by_assignment[i] for i in range(len(data.assignments))}
        candidate_resource_ids = {resource_real_id_by_temp_id[a.resource_temp_id] for a in data.assignments}
        existing_pairs_result = await db.execute(
            select(ResourceAssignment.activity_id, ResourceAssignment.resource_id).where(
                ResourceAssignment.activity_id.in_(candidate_activity_ids),
                ResourceAssignment.resource_id.in_(candidate_resource_ids),
            )
        )
        already_assigned_pairs = set(existing_pairs_result.all())

    activities_with_assignments: set[uuid.UUID] = set()
    assignments_to_insert: list[tuple[uuid.UUID, uuid.UUID, BulkAssignmentInput]] = []
    for i, a in enumerate(data.assignments):
        activity_id = resolved_activity_id_by_assignment[i]
        resource_id = resource_real_id_by_temp_id[a.resource_temp_id]
        if (activity_id, resource_id) in already_assigned_pairs:
            continue
        resource = next(r for r in data.resources if r.temp_id == a.resource_temp_id)
        # Same rule resource_assignment.py's own _validate_assignment_fields
        # enforces for a single create — material has no sensible default
        # utilisation, a quantity must be given.
        if resource.resource_type == "material" and a.quantity is None:
            raise HTTPException(status_code=422, detail=f"quantity is required for material resource '{resource.name}'")
        activities_with_assignments.add(activity_id)
        assignments_to_insert.append((activity_id, resource_id, a))

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

    # Every activity's role is already fully determined by this point
    # (staged.activity_type + parent_real_id, both already resolved in
    # ordered_inserts) — so the starting code number for each of P/W/T/M is
    # computed once per role here (at most 4 queries total), instead of
    # once per activity being inserted. A real IFC-driven generation of a
    # few hundred activities used to do a few hundred serialized aggregate
    # queries (plus the autoflush each one forces) just for code numbering,
    # before the actual CPM/hierarchy work below even starts.
    roles_by_temp_id = {
        temp_id: _activity_role(activity_by_temp_id[temp_id].activity_type, parent_real_id)
        for temp_id, parent_real_id, _sort_order in ordered_inserts
    }
    role_counts = Counter(roles_by_temp_id.values())
    role_code_iters = {
        role: iter(await _next_role_codes_batch(db, data.project_id, role, count))
        for role, count in role_counts.items()
    }

    activities_by_real_id: dict[uuid.UUID, Activity] = {}
    for temp_id, parent_real_id, sort_order in ordered_inserts:
        staged = activity_by_temp_id[temp_id]
        # staged.activity_type, not a hardcoded "task" (2026-07-17, per Maro:
        # Construction Start/Substantial Completion are real start_milestone/
        # finish_milestone rows, not 0-duration tasks) — brand-new leaf either
        # way; wbs_summary promotion still happens automatically below via
        # _recompute_hierarchy once everything's inserted.
        role = roles_by_temp_id[temp_id]
        code = next(role_code_iters[role])
        activity_id = real_id_by_temp_id[temp_id]
        activity = Activity(
            id=activity_id,
            code=code, wbs_role=role,
            project_id=data.project_id, schedule_variant_id=period.schedule_variant_id,
            schedule_period_id=data.schedule_period_id,
            task_name=staged.task_name, activity_type=staged.activity_type, parent_id=parent_real_id, sort_order=sort_order,
            duration_hours=staged.duration_hours, calendar_id=data.calendar_id,
            schedule_category=staged.category, schedule_phase_key=staged.phase_key,
            schedule_quantity=staged.quantity,
        )
        _apply_computed_fields(activity)
        db.add(activity)
        activities_by_real_id[activity_id] = activity

    # Discipline UDF (2026-07-17, per Maro: "create a udf column called
    # Discipline... so i can also choose to group by discipline") — found
    # once per project by (project_id, entity_type, name) rather than
    # created fresh every generation run, since a second run in the same
    # project would otherwise collide with UserDefinedFieldDefinition's own
    # uniqueness constraint on that triple. A plain "text" field, same as
    # any other UDF a user could have created by hand through the normal
    # User Defined Fields UI — nothing about this one is special-cased
    # beyond how it gets populated here.
    discipline_by_activity_id = {
        real_id_by_temp_id[a.temp_id]: a.discipline for a in data.activities if a.discipline
    }
    if discipline_by_activity_id:
        discipline_definition = (await db.execute(
            select(UserDefinedFieldDefinition).where(
                UserDefinedFieldDefinition.project_id == data.project_id,
                UserDefinedFieldDefinition.entity_type == "activity",
                UserDefinedFieldDefinition.name == "Discipline",
            )
        )).scalar_one_or_none()
        if discipline_definition is None:
            discipline_definition = UserDefinedFieldDefinition(
                project_id=data.project_id, entity_type="activity", name="Discipline", data_type="text",
            )
            db.add(discipline_definition)
            await db.flush()  # need its real id before UserDefinedFieldValue rows can reference it below
        for activity_id, discipline in discipline_by_activity_id.items():
            db.add(UserDefinedFieldValue(
                field_definition_id=discipline_definition.id, record_id=activity_id, value_text=discipline,
            ))

    for r in data.resources:
        if r.temp_id not in new_resource_temp_ids:
            continue  # deduped to an existing row by name — nothing to insert
        db.add(Resource(
            id=resource_real_id_by_temp_id[r.temp_id], project_id=data.project_id, resource_type=r.resource_type,
            name=r.name, unit=r.unit, rate=r.rate, max_hours_per_day=r.max_hours_per_day,
        ))

    for activity_id, resource_id, a in assignments_to_insert:
        db.add(ResourceAssignment(
            id=uuid.uuid4(), activity_id=activity_id, resource_id=resource_id,
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
        await cost_sync.sync_cost_element_from_resources(db, activity_id, commit=False)
    await db.commit()

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
        resource_count=len(new_resource_temp_ids),
        assignment_count=len(assignments_to_insert),
        relationship_count=len(data.relationships),
        model_element_link_count=link_count,
        activity_ids_by_temp_id=real_id_by_temp_id,
        resource_ids_by_temp_id=resource_real_id_by_temp_id,
    )
