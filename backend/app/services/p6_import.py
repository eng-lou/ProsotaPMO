from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.calendar import Calendar, CalendarBreak, CalendarException
from app.models.cost_element import CostElement
from app.models.project import Project
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.schedule_baseline import ScheduleBaseline, ScheduleBaselineActivity
from app.models.schedule_period import SchedulePeriod
from app.models.user_defined_field import UserDefinedFieldDefinition, UserDefinedFieldValue
from app.schemas.activity import ActivityStatus, is_milestone_type
from app.schemas.schedule_variant import ScheduleVariantCreate
from app.services import cost_sync, schedule_variant, scheduling_cpm
from app.services.activity import (
    _activity_role,
    _apply_computed_fields,
    _apply_status_change,
    _next_role_code,
    _recompute_hierarchy,
)
from app.services.p6_excel_progress import ParsedProgressRow
from app.services.p6_import_parse import ParsedActivity, ParsedP6Schedule, ParsedResource, ParsedWbs
from app.services.scheduling_cpm import _find_cycle

_P6_ACTIVITY_ID_UDF_NAME = "P6 Activity ID"


@dataclass
class P6ImportSummary:
    schedule_variant_id: uuid.UUID
    schedule_period_id: uuid.UUID
    variant_name: str
    calendar_count: int = 0
    resource_count: int = 0
    activity_count: int = 0
    relationship_count: int = 0
    assignment_count: int = 0
    udf_value_count: int = 0
    baseline_count: int = 0
    # Human-readable notes on anything skipped or approximated — combines
    # p6_import_parse.py's own parse-time notes with anything this layer
    # itself couldn't resolve (a relationship that would have created a
    # cycle, an assignment referencing an activity/resource that never
    # resolved, ...). Never silently dropped — same transparency pattern
    # schedule_variant.py's own promote_variant already established with
    # its unmatched_codes.
    skipped: list[str] = field(default_factory=list)


def _net_hours_per_day(day_start: time, day_end: time, breaks: list[tuple[time, time]]) -> Decimal:
    start_minutes = day_start.hour * 60 + day_start.minute
    end_minutes = day_end.hour * 60 + day_end.minute
    break_minutes = sum((b_end.hour * 60 + b_end.minute) - (b_start.hour * 60 + b_start.minute) for b_start, b_end in breaks)
    return Decimal(max(0, end_minutes - start_minutes - break_minutes)) / Decimal(60)


_P6_DAY_TO_WORKS_FIELD = {
    1: "works_sunday", 2: "works_monday", 3: "works_tuesday", 4: "works_wednesday",
    5: "works_thursday", 6: "works_friday", 7: "works_saturday",
}


async def import_pmxml(db: AsyncSession, project_id: uuid.UUID, parsed: ParsedP6Schedule) -> P6ImportSummary:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    skipped = list(parsed.skipped)

    # A brand new, non-master Schedule Variant — never touches the
    # project's existing master or any other variant (2026-07-16, per
    # Maro's own plan sign-off: import must be reviewable/discardable, not
    # a silent merge). create_variant already seeds one fresh live
    # SchedulePeriod for it (app/services/schedule_variant.py) — no need to
    # construct that separately.
    variant_name = f"Imported: {parsed.project_name}"[:200]
    variant = await schedule_variant.create_variant(
        db, ScheduleVariantCreate(project_id=project_id, name=variant_name, variant_type="P6 Import")
    )
    period_result = await db.execute(
        select(SchedulePeriod).where(SchedulePeriod.schedule_variant_id == variant.id, SchedulePeriod.freeze_status == "live")
    )
    period = period_result.scalar_one()
    # Anchor CPM to the P6 file's own DataDate, not "today" — a freshly
    # created SchedulePeriod's start_date is null, and
    # scheduling_cpm.data_date_for_period falls back to date.today() for
    # that case, which is exactly why re-scheduling a real 2011-dated P6
    # export against a 2026 "now" produced wildly wrong dates (2026-09-03,
    # per Maro: "the dates are very off").
    if parsed.data_date is not None:
        period.start_date = parsed.data_date

    # --- Calendars: match existing project calendars by name, else stage new ones ---
    existing_calendars_result = await db.execute(select(Calendar).where(Calendar.project_id == project_id))
    existing_calendar_by_name = {c.name: c for c in existing_calendars_result.scalars().all()}
    calendar_real_id_by_object_id: dict[str, uuid.UUID] = {}
    default_hours_per_day = Decimal(8)  # overwritten below once at least one calendar resolves
    # scheduling_cpm._CalendarLookup.resolve_calendar_id 422s outright for any
    # activity whose own calendar_id is None once the project has no
    # is_project_default calendar at all — a real gap found importing into a
    # brand-new project with zero calendars of its own (2026-07-16). Deferred
    # to a single fallback after the loop (not just "first one created")
    # because a matched *existing* calendar may already be the project's
    # default, in which case nothing new should be flagged at all.
    existing_default_exists = any(c.is_project_default for c in existing_calendar_by_name.values())
    default_calendar_assigned = existing_default_exists
    first_created_calendar: Calendar | None = None
    for pc in parsed.calendars:
        existing = existing_calendar_by_name.get(pc.name)
        if existing is not None:
            calendar_real_id_by_object_id[pc.object_id] = existing.id
            continue
        make_default = not default_calendar_assigned and pc.is_default
        calendar = Calendar(
            id=uuid.uuid4(), project_id=project_id, name=pc.name, is_project_default=make_default,
            day_start_time=pc.day_start, day_end_time=pc.day_end,
            **{_P6_DAY_TO_WORKS_FIELD[d]: working for d, working in pc.works.items()},
        )
        if make_default:
            default_calendar_assigned = True
        if first_created_calendar is None:
            first_created_calendar = calendar
        db.add(calendar)
        calendar_real_id_by_object_id[pc.object_id] = calendar.id
        for i, (b_start, b_end) in enumerate(pc.breaks):
            db.add(CalendarBreak(id=uuid.uuid4(), calendar_id=calendar.id, label=f"Break {i + 1}", start_time=b_start, end_time=b_end))
        for ex in pc.exceptions:
            db.add(CalendarException(
                id=uuid.uuid4(), calendar_id=calendar.id, label="Imported exception",
                start_date=ex.start_date, end_date=ex.end_date, is_working=ex.is_working,
                start_time=ex.start_time, end_time=ex.end_time,
            ))
    if not default_calendar_assigned and first_created_calendar is not None:
        first_created_calendar.is_project_default = True
    if parsed.calendars:
        default_pc = next((c for c in parsed.calendars if c.is_default), parsed.calendars[0])
        default_hours_per_day = _net_hours_per_day(default_pc.day_start, default_pc.day_end, default_pc.breaks) or Decimal(8)

    # --- Resources: match existing project resources by name, else stage new ones ---
    existing_resources_result = await db.execute(select(Resource).where(Resource.project_id == project_id))
    existing_resource_by_name = {r.name: r for r in existing_resources_result.scalars().all()}
    resource_real_id_by_object_id: dict[str, uuid.UUID] = {}
    for pr in parsed.resources:
        existing = existing_resource_by_name.get(pr.name)
        if existing is not None:
            resource_real_id_by_object_id[pr.object_id] = existing.id
            continue
        rate = pr.rate_per_unit or Decimal(0)
        # P6 prices labour/equipment per hour; Prosota prices them per day —
        # inverse of p6_export.py's own day-rate -> hourly conversion.
        # material/subcontractor/cost need no conversion (already priced
        # per whatever unit P6's "each" pricing means for them).
        if pr.is_hourly:
            rate = rate * default_hours_per_day
        resource = Resource(
            id=uuid.uuid4(), project_id=project_id, resource_type=pr.resource_type, name=pr.name,
            unit="day" if pr.is_hourly else "each", rate=rate,
            calendar_id=calendar_real_id_by_object_id.get(pr.calendar_object_id) if pr.calendar_object_id else None,
        )
        db.add(resource)
        resource_real_id_by_object_id[pr.object_id] = resource.id

    # --- UDF definitions: match existing project activity-UDFs by name, else create ---
    existing_udf_result = await db.execute(
        select(UserDefinedFieldDefinition).where(
            UserDefinedFieldDefinition.project_id == project_id, UserDefinedFieldDefinition.entity_type == "activity"
        )
    )
    existing_udf_by_name = {d.name: d for d in existing_udf_result.scalars().all()}
    udf_def_real_id_by_object_id: dict[str, uuid.UUID] = {}
    for pu in parsed.udf_types:
        if pu.subject_area != "Activity":
            skipped.append(f"UDF \"{pu.title}\" applies to {pu.subject_area}, not Activity — skipped (only activity UDFs are supported).")
            continue
        existing = existing_udf_by_name.get(pu.title)
        if existing is not None:
            udf_def_real_id_by_object_id[pu.object_id] = existing.id
            continue
        definition = UserDefinedFieldDefinition(
            id=uuid.uuid4(), project_id=project_id, entity_type="activity", name=pu.title[:100], data_type=pu.data_type,
        )
        db.add(definition)
        udf_def_real_id_by_object_id[pu.object_id] = definition.id

    # P6's own Activity Id (e.g. "EC2430", distinct from Prosota's own
    # generated P/W/T/M code) has no dedicated column on Activity — captured
    # as a UDF instead, same as any other imported field with no direct
    # Prosota equivalent (2026-09-03, per Maro: "i didnt see any udf for the
    # P6 Activity ID... udfs need to be created to capture" it). Also doubles
    # as the join key for matching this file's own <BaselineProject>
    # snapshots back to the activities just imported (see the baseline
    # section below) — those carry the same stable Id, not the live
    # project's internal ObjectId.
    p6_activity_id_udf = existing_udf_by_name.get(_P6_ACTIVITY_ID_UDF_NAME)
    if p6_activity_id_udf is None:
        p6_activity_id_udf = UserDefinedFieldDefinition(
            id=uuid.uuid4(), project_id=project_id, entity_type="activity",
            name=_P6_ACTIVITY_ID_UDF_NAME, data_type="text",
        )
        db.add(p6_activity_id_udf)
    p6_activity_id_udf_id = p6_activity_id_udf.id

    # --- WBS -> wbs_summary Activities, parent-before-child ---
    wbs_by_object_id: dict[str, ParsedWbs] = {w.object_id: w for w in parsed.wbs_nodes}
    wbs_real_id_by_object_id: dict[str, uuid.UUID] = {}
    wbs_sort_counter = 0

    # One root Activity representing the true P6 <Project> itself (role P) —
    # in real P6, the Project always sits *above* the WBS tree as its own
    # distinct object (confirmed against a real file: <Project> and <WBS>
    # have entirely separate ObjectId sequences), so every top-level WBS
    # branch/activity in this file is really a *child* of the project, never
    # itself the project. The old code let every top-level WBS node (parent
    # nil) become its own separate P row — fine for Prosota's own
    # single-branch round-tripped exports, but wrong for a real multi-branch
    # P6 project (2026-09-03, per Maro's own screenshot: "Building 1",
    # "Garage 1" etc. each showing as their own P-000N when they should all
    # be W under one Saratoga-level P).
    root_activity_id = uuid.uuid4()
    root_code = await _next_role_code(db, project_id, "P")
    root_activity = Activity(
        id=root_activity_id, code=root_code, wbs_role="P", project_id=project_id,
        schedule_variant_id=variant.id, schedule_period_id=period.id,
        task_name=parsed.project_name[:500], activity_type="wbs_summary", parent_id=None,
        sort_order=-1,
    )
    _apply_computed_fields(root_activity)
    db.add(root_activity)

    async def resolve_wbs(object_id: str, visiting: set[str]) -> uuid.UUID:
        if object_id in wbs_real_id_by_object_id:
            return wbs_real_id_by_object_id[object_id]
        pw = wbs_by_object_id.get(object_id)
        if pw is None:
            raise KeyError(object_id)
        if object_id in visiting:
            skipped.append(f"WBS \"{pw.name}\" is part of a circular parent chain — imported under the project root.")
            parent_real_id = root_activity_id
        else:
            visiting = visiting | {object_id}
            # No P6 parent (a true top-level WBS branch, e.g. "Building 1")
            # nests under the synthetic project-root Activity above, not at
            # Prosota's own top level — see root_activity_id's own header.
            parent_real_id = root_activity_id
            if pw.parent_object_id is not None and pw.parent_object_id in wbs_by_object_id:
                try:
                    parent_real_id = await resolve_wbs(pw.parent_object_id, visiting)
                except KeyError:
                    parent_real_id = root_activity_id
        nonlocal wbs_sort_counter
        # Brand-new leaf, same as bulk_generate.py's own plan_activity —
        # promotion to wbs_summary happens in the final _recompute_hierarchy
        # pass below once every child is actually in place, not set here.
        role = _activity_role("task", parent_real_id)
        code = await _next_role_code(db, project_id, role)
        activity_id = uuid.uuid4()
        activity = Activity(
            id=activity_id, code=code, wbs_role=role, project_id=project_id,
            schedule_variant_id=variant.id, schedule_period_id=period.id,
            task_name=pw.name[:500], activity_type="task", parent_id=parent_real_id,
            sort_order=wbs_sort_counter, commentary=pw.commentary,
        )
        wbs_sort_counter += 1
        _apply_computed_fields(activity)
        db.add(activity)
        wbs_real_id_by_object_id[object_id] = activity_id
        return activity_id

    for object_id in list(wbs_by_object_id):
        try:
            await resolve_wbs(object_id, set())
        except KeyError:
            skipped.append(f"WBS \"{wbs_by_object_id[object_id].name}\" references a parent that doesn't exist in this file.")

    # --- Activities (leaves only — every WBS node above is already its own wbs_summary Activity) ---
    activity_real_id_by_object_id: dict[str, uuid.UUID] = {}
    activity_by_object_id: dict[str, ParsedActivity] = {a.object_id: a for a in parsed.activities}
    activity_sort_counter = 0
    activity_real_id_by_p6_id: dict[str, tuple[uuid.UUID, str]] = {}
    for pa in parsed.activities:
        parent_real_id = wbs_real_id_by_object_id.get(pa.wbs_object_id) if pa.wbs_object_id else None
        if pa.wbs_object_id and parent_real_id is None:
            skipped.append(f"Activity \"{pa.name}\" references a WBS that doesn't exist in this file — imported under the project root.")
        # No WBS at all (or an unresolvable one) still belongs under the
        # project root, never fully detached — see root_activity_id's own
        # header for why a real P6 file has no true "top level" above it.
        if parent_real_id is None:
            parent_real_id = root_activity_id
        role = _activity_role(pa.activity_type, parent_real_id)
        code = await _next_role_code(db, project_id, role)
        activity_id = uuid.uuid4()
        # ActivityBase's own milestones_have_zero_duration validator 500s the
        # *response* serialization (not the import itself, which has no such
        # check) the moment anything later tries to read this row back — a
        # real bug found importing EC00610 - B1.xml (2026-07-16): P6's own
        # <PlannedDuration> is routinely nonzero on a Start/Finish Milestone
        # activity even though P6 treats it as a zero-length point in time,
        # so it can't be carried through verbatim the way a task's duration
        # is.
        duration_hours = Decimal(0) if is_milestone_type(pa.activity_type) else pa.duration_hours
        activity = Activity(
            id=activity_id, code=code, wbs_role=role, project_id=project_id,
            schedule_variant_id=variant.id, schedule_period_id=period.id,
            task_name=pa.name[:500], activity_type=pa.activity_type, parent_id=parent_real_id,
            sort_order=activity_sort_counter,
            duration_hours=duration_hours, pct_complete=pa.pct_complete,
            actual_start=pa.actual_start, actual_finish=pa.actual_finish,
            constraint_type=pa.constraint_type, constraint_date=pa.constraint_date,
            calendar_id=calendar_real_id_by_object_id.get(pa.calendar_object_id) if pa.calendar_object_id else None,
            commentary=pa.commentary,
        )
        activity_sort_counter += 1
        _apply_computed_fields(activity)
        db.add(activity)
        activity_real_id_by_object_id[pa.object_id] = activity_id
        if pa.code:
            activity_real_id_by_p6_id[pa.code] = (activity_id, code)

    # --- Relationships — validated against a real cycle check before any insert, same as bulk_generate.py ---
    def resolve_activity(object_id: str) -> uuid.UUID | None:
        return activity_real_id_by_object_id.get(object_id) or wbs_real_id_by_object_id.get(object_id)

    edges: list[tuple[uuid.UUID, uuid.UUID]] = []
    relationship_edges: list[tuple[uuid.UUID, uuid.UUID, ParsedActivity | None]] = []
    # Prosota allows only one relationship row per ordered (predecessor,
    # successor) pair (uq_activity_relationship_pair) — a real external P6
    # file can legitimately list the same pair twice (e.g. once from each
    # side's own Relationship block), which P6 itself tolerates but Prosota's
    # schema doesn't. First one wins; found importing EC00610 - B1.xml
    # (2026-07-16), which 500'd on the second insert before this dedupe.
    seen_pairs: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for rel in parsed.relationships:
        predecessor_id = resolve_activity(rel.predecessor_object_id)
        successor_id = resolve_activity(rel.successor_object_id)
        if predecessor_id is None or successor_id is None:
            skipped.append("A relationship referenced an activity that wasn't imported — skipped.")
            continue
        if (predecessor_id, successor_id) in seen_pairs:
            skipped.append("Duplicate relationship between the same two activities — skipped (only one link between any pair is kept).")
            continue
        seen_pairs.add((predecessor_id, successor_id))
        candidate_edges = edges + [(predecessor_id, successor_id)]
        node_ids = {n for edge in candidate_edges for n in edge}
        if _find_cycle(candidate_edges, node_ids):
            skipped.append(f"A relationship between \"{rel.predecessor_object_id}\" and \"{rel.successor_object_id}\" would create a circular dependency — skipped.")
            continue
        edges = candidate_edges
        relationship_edges.append((predecessor_id, successor_id, rel))

    relationship_count = 0
    for predecessor_id, successor_id, rel in relationship_edges:
        db.add(ActivityRelationship(
            id=uuid.uuid4(), predecessor_id=predecessor_id, successor_id=successor_id,
            relationship_type=rel.relationship_type, lag_hours=rel.lag_hours,
        ))
        relationship_count += 1

    # --- Resource assignments ---
    assignment_count = 0
    activities_with_assignments: set[uuid.UUID] = set()
    for asg in parsed.assignments:
        activity_id = activity_real_id_by_object_id.get(asg.activity_object_id)
        resource_id = resource_real_id_by_object_id.get(asg.resource_object_id)
        if activity_id is None or resource_id is None:
            skipped.append("A resource assignment referenced an activity or resource that wasn't imported — skipped.")
            continue
        pa = activity_by_object_id.get(asg.activity_object_id)
        parsed_resource = next((r for r in parsed.resources if r.object_id == asg.resource_object_id), None)
        if parsed_resource is not None and parsed_resource.resource_type == "material":
            db.add(ResourceAssignment(id=uuid.uuid4(), activity_id=activity_id, resource_id=resource_id, quantity=asg.planned_units))
        else:
            duration_hours = pa.duration_hours if pa is not None and pa.duration_hours else Decimal(0)
            utilisation = (asg.planned_units / duration_hours * Decimal(100)) if duration_hours else Decimal(100)
            utilisation = min(Decimal(100), max(Decimal("0.01"), utilisation))
            db.add(ResourceAssignment(id=uuid.uuid4(), activity_id=activity_id, resource_id=resource_id, utilisation_pct=utilisation))
        activities_with_assignments.add(activity_id)
        assignment_count += 1

    # --- UDF values (activity-scoped only, matching p6_export.py's own scope) ---
    udf_value_count = 0
    for pa in parsed.activities:
        activity_id = activity_real_id_by_object_id.get(pa.object_id)
        if activity_id is None:
            continue
        if pa.code:
            db.add(UserDefinedFieldValue(
                id=uuid.uuid4(), field_definition_id=p6_activity_id_udf_id, record_id=activity_id,
                value_text=pa.code,
            ))
            udf_value_count += 1
        for v in pa.udf_values:
            definition_id = udf_def_real_id_by_object_id.get(v.udf_type_object_id)
            if definition_id is None:
                continue
            db.add(UserDefinedFieldValue(
                id=uuid.uuid4(), field_definition_id=definition_id, record_id=activity_id,
                value_text=v.text, value_number=v.number, value_date=v.date_value,
            ))
            udf_value_count += 1

    # --- Baselines: this file's own <BaselineProject> snapshots, matched
    # back to the activities just imported by P6's stable Activity Id
    # (2026-09-03, per Maro: "i also exported it with two baselines, i need
    # those to be captured as well"). Deliberately NOT assigned (is_active
    # stays False) — same "capture vs. assign are two separate deliberate
    # actions" rule app/services/schedule_baseline.py's own capture_baseline
    # already follows; the user picks which one (if any) to assign
    # afterwards via the normal Baseline Manager UI. WBS/summary rows have
    # no P6 Activity Id of their own to match on, so only leaf activities
    # get a snapshot — same scope p6_export.py's own UDF capture already
    # keeps to (activity-level only).
    baseline_count = 0
    for pb in parsed.baselines:
        baseline = ScheduleBaseline(
            id=uuid.uuid4(), schedule_period_id=period.id,
            name=pb.name[:200], baseline_date=pb.data_date or date.today(),
        )
        db.add(baseline)
        matched = 0
        for pba in pb.activities:
            match = activity_real_id_by_p6_id.get(pba.p6_activity_id)
            if match is None:
                continue
            activity_id, prosota_code = match
            db.add(ScheduleBaselineActivity(
                id=uuid.uuid4(), baseline_id=baseline.id, activity_id=activity_id, code=prosota_code,
                start=pba.start, finish=pba.finish, duration_hours=pba.duration_hours,
            ))
            matched += 1
        if matched == 0 and pb.activities:
            skipped.append(f"Baseline \"{pb.name}\" had no activities matching this import — skipped.")
        else:
            baseline_count += 1

    await db.commit()

    # Same two-pass shape bulk_generate.py uses for its own batch insert —
    # hierarchy -> CPM -> hierarchy again, run once for the whole import,
    # not once per row.
    await _recompute_hierarchy(db, period.id)
    await scheduling_cpm.recompute_schedule(db, period.id)
    await _recompute_hierarchy(db, period.id)
    for activity_id in activities_with_assignments:
        await cost_sync.sync_cost_element_from_resources(db, activity_id, commit=False)
    await db.commit()

    return P6ImportSummary(
        schedule_variant_id=variant.id, schedule_period_id=period.id, variant_name=variant.name,
        calendar_count=len(calendar_real_id_by_object_id), resource_count=len(resource_real_id_by_object_id),
        activity_count=1 + len(wbs_real_id_by_object_id) + len(activity_real_id_by_object_id),
        relationship_count=relationship_count, assignment_count=assignment_count, udf_value_count=udf_value_count,
        baseline_count=baseline_count, skipped=skipped,
    )


@dataclass
class ProgressUpdateSummary:
    matched: int = 0
    unmatched: list[str] = field(default_factory=list)
    cost_elements_updated: int = 0


async def apply_progress_snapshot(
    db: AsyncSession, project_id: uuid.UUID, schedule_period_id: uuid.UUID, rows: list[ParsedProgressRow],
) -> ProgressUpdateSummary:
    """Applies one P6 Excel progress extract onto an already-imported
    schedule's own activities (2026-09-04, per Maro — a series of monthly
    P6 Excel exports, each simulating progress a month further along, meant
    to be layered onto a schedule already brought in via import_pmxml above
    and captured as a chronological run of baselines so the PV/EV/AC Trend
    chart has real data). NOT a fresh import — a targeted update of
    status/actual dates/% complete on existing rows, matched by the "P6
    Activity ID" UDF value import_pmxml already captures per activity, plus
    each matched activity's own linked (source="schedule") Cost Element's
    actual cost. Doesn't touch duration/relationships/calendar, so no CPM
    recompute is needed here — only progress moves, never the plan.

    Status -> Prosota's own 4-state machine (_apply_status_change, the
    single authoritative place status/pct_complete/actual dates get derived
    together — same function ActivityForm's own Status field already goes
    through) drives the reset semantics (clearing suspend_date/resume_date
    etc.), then this overwrites pct_complete/actual_start/actual_finish
    with the real historical values P6 already computed for this exact
    date, rather than leaving _apply_status_change's own "now"-based
    defaults. In Progress has no direct "% Complete" column in this report
    (unlike a full PMXML export's own <PercentComplete>) — approximated as
    EV/BAC (both already P6-computed), clamped to 1-99: a real cost overrun
    can push EV above BAC, which would otherwise misrepresent a genuinely
    in-progress activity as complete if taken at face value.
    """
    udf_def = (await db.execute(
        select(UserDefinedFieldDefinition).where(
            UserDefinedFieldDefinition.project_id == project_id,
            UserDefinedFieldDefinition.entity_type == "activity",
            UserDefinedFieldDefinition.name == _P6_ACTIVITY_ID_UDF_NAME,
        )
    )).scalar_one_or_none()
    if udf_def is None:
        raise HTTPException(
            status_code=422,
            detail="This project has no \"P6 Activity ID\" UDF yet — import a PMXML file into it first.",
        )

    udf_values = (await db.execute(
        select(UserDefinedFieldValue).where(UserDefinedFieldValue.field_definition_id == udf_def.id)
    )).scalars().all()
    activity_id_by_p6_id: dict[str, uuid.UUID] = {v.value_text: v.record_id for v in udf_values if v.value_text}

    activities = (await db.execute(
        select(Activity).where(Activity.schedule_period_id == schedule_period_id)
    )).scalars().all()
    activity_by_id = {a.id: a for a in activities}

    elements = (await db.execute(
        select(CostElement).where(
            CostElement.linked_activity_id.in_(activity_by_id.keys()), CostElement.source == "schedule",
        )
    )).scalars().all()
    element_by_activity_id = {e.linked_activity_id: e for e in elements}

    _STATUS_BY_P6_TEXT: dict[str, ActivityStatus] = {
        "Not Started": "planned", "In Progress": "in_progress", "Completed": "completed",
    }

    summary = ProgressUpdateSummary()
    now = datetime.now()
    for row in rows:
        activity_id = activity_id_by_p6_id.get(row.activity_id)
        activity = activity_by_id.get(activity_id) if activity_id is not None else None
        if activity is None:
            summary.unmatched.append(row.activity_id)
            continue
        summary.matched += 1

        target = _STATUS_BY_P6_TEXT.get(row.status, "planned")
        _apply_status_change(activity, target, now)
        if target == "completed":
            activity.actual_start = row.start or activity.actual_start
            activity.actual_finish = row.finish or activity.actual_finish
        elif target == "in_progress":
            activity.actual_start = row.start or activity.actual_start
            activity.actual_finish = None
            if row.bac is not None and row.bac != 0 and row.earned_value_cost is not None:
                pct = row.earned_value_cost / row.bac * Decimal(100)
                activity.pct_complete = min(Decimal(99), max(Decimal(1), pct)).quantize(Decimal("1"))
        _apply_computed_fields(activity)

        element = element_by_activity_id.get(activity.id)
        if element is not None and row.actual_cost is not None:
            element.actuals = row.actual_cost
            if activity.pct_complete is not None:
                element.pct_complete = int(activity.pct_complete)
            summary.cost_elements_updated += 1

    await db.commit()
    return summary
