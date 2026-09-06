from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, time
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
from app.models.schedule_variant import ScheduleVariant
from app.models.user_defined_field import UserDefinedFieldDefinition, UserDefinedFieldValue
from app.services import resource_costing
from app.services.scheduling_cpm import _build_calendar_lookup


def _p6_guid() -> str:
    """PMXML's own {8-4-4-4-12} GUID format, confirmed directly against the
    real reference file's own <GUID> values (e.g.
    "{2C088E12-5FF4-400F-B6B5-CB44B457DA51}"). Not needed for a re-import to
    work (GUID is for cross-database sync tracking, not structural), and
    this phase doesn't round-trip anyway — but matching the real shape costs
    nothing and avoids an obviously-fake-looking value. XER used a different
    base64-encoded format; removed 2026-07-16 along with the rest of the XER
    exporter (per Maro: "stick to xml. remove the xer functionality
    completely" — XML alone was already confirmed working end-to-end
    against a real P6 install)."""
    return "{" + str(uuid.uuid4()).upper() + "}"


# Prosota's own schedule-generation naming convention (scheduleGeneration.ts)
# joins WBS/category/phase with an em dash ("Elevator Pit — Footings —
# Excavate & Prep"), which reads fine in this app's own UI but doesn't round-
# trip cleanly through P6 (2026-07-16, per Maro testing a real import: "it
# changed task names slightly in P6 i think that type of hyphen doesnt work
# well in P6... it had some weird symbols due to the hyphen thing"). Applied
# to every free-text field written into the export — task/WBS/resource
# names, commentary/notes — not just activity names, since the same
# character could appear anywhere a user typed one in. Deliberately narrow
# (exactly the "smart punctuation" MS Word/this app's own em-dash-using
# convention actually produces) rather than a blanket non-ASCII strip, which
# would also mangle genuinely-intended accented names/notes P6 handles fine.
_P6_TEXT_REPLACEMENTS = {
    "—": "-",  # em dash
    "–": "-",  # en dash
    "‘": "'", "’": "'",  # curly single quotes
    "“": '"', "”": '"',  # curly double quotes
    "…": "...",  # ellipsis
}


def _sanitize_p6_text(text: str | None) -> str | None:
    if text is None:
        return None
    for char, replacement in _P6_TEXT_REPLACEMENTS.items():
        text = text.replace(char, replacement)
    return text


# Strips a redundant "<parent WBS name> — " (or "-") prefix from an
# activity's own name when it exactly repeats its immediate parent WBS's
# name (2026-07-16, per Maro's screenshot of a real P6 import: activities
# nested under a WBS named "Elevator Pit" still read
# "Elevator Pit | Footings | Excavate & Prep" — P6 already shows the WBS
# nesting itself, so re-stating the storey name on every one of its own
# child activities is pure clutter there, even though the *rest* of the
# name (category/phase) is genuinely new information the WBS nesting alone
# doesn't capture). Deliberately conservative — only strips an exact,
# unambiguous match, leaving anything else (a manually-named activity with
# no such prefix, say) completely untouched.
def _strip_redundant_wbs_prefix(activity_name: str, parent_wbs_name: str) -> str:
    for sep in (" — ", " - "):
        prefix = f"{parent_wbs_name}{sep}"
        if activity_name.startswith(prefix):
            return activity_name[len(prefix):]
    return activity_name


class _IdSequence:
    """Mints small positive sequential integers for one P6 entity type,
    mapping a Prosota UUID (or any other stable key) to the same integer on
    every call for that key. P6's XER/XML both need small integer object
    ids, never UUIDs — see p6_export.py's own module header. A fresh
    sequence per export run (not persisted) is fine since this phase is
    export-only; nothing needs these ids to stay stable across two separate
    export runs."""

    def __init__(self, start: int = 1):
        self._next = start
        self._by_key: dict[object, int] = {}

    def id_for(self, key: object) -> int:
        if key not in self._by_key:
            self._by_key[key] = self._next
            self._next += 1
        return self._by_key[key]


@dataclass
class P6CalendarException:
    start_date: datetime
    end_date: datetime
    is_working: bool
    start_time: time | None
    end_time: time | None


@dataclass
class P6Calendar:
    id: int
    guid: str
    name: str
    is_default: bool
    day_start: time
    day_end: time
    # Sunday=1 .. Saturday=7, P6's own DayOfWeek numbering (confirmed in the
    # real CALENDAR.clndr_data sample — day 1 is always the empty/non-working
    # Sunday slot in both reference calendars). True = a working day.
    works_by_p6_day: dict[int, bool]
    # Subtracted from every working day's start/end envelope — a lunch break
    # becomes two separate shift segments either side of it (computed once
    # here, in _shift_segments, rather than by each format writer).
    breaks: list[tuple[time, time]]
    exceptions: list[P6CalendarException]


@dataclass
class P6Wbs:
    id: int
    guid: str
    code: str
    name: str
    parent_id: int | None
    seq_num: int
    is_project_node: bool
    commentary: str | None


@dataclass
class P6Activity:
    id: int
    guid: str
    wbs_id: int
    calendar_id: int
    code: str
    name: str
    # TT_Task | TT_Mile | TT_FinMile — see _task_type.
    task_type: str
    # TK_NotStart | TK_Active | TK_Complete — see _status_code.
    status_code: str
    pct_complete: Decimal
    duration_hours: Decimal
    start: datetime | None
    finish: datetime | None
    actual_start: datetime | None
    actual_finish: datetime | None
    total_float_hours: Decimal | None
    free_float_hours: Decimal | None
    # P6 cstr_type code, or None for no constraint (ASAP) — see
    # _CONSTRAINT_TYPE_MAP's own header for the caveat on this mapping.
    constraint_type: str | None
    constraint_date: datetime | None
    commentary: str | None


@dataclass
class P6Relationship:
    id: int
    pred_id: int
    succ_id: int
    # PR_FS | PR_SS | PR_FF | PR_SF
    type: str
    lag_hours: Decimal


@dataclass
class P6Resource:
    id: int
    guid: str
    short_name: str
    name: str
    # RT_Labor | RT_Mat | RT_Equip — see _resource_type.
    rsrc_type: str
    rate: Decimal
    # QT_Hour for day-rate types (labour/equipment/crew), QT_Each otherwise
    # (material/subcontractor/cost) — matches cost_qty_type's own P6 meaning
    # ("what unit does cost_per_qty price in").
    cost_qty_type: str
    calendar_id: int | None
    notes: str | None


@dataclass
class P6Assignment:
    id: int
    task_id: int
    rsrc_id: int
    qty: Decimal
    cost_per_qty: Decimal
    cost: Decimal
    # Real progress, not the hardcoded 0 this export used to always write
    # (2026-09-06, per Maro: re-importing an exported project back into
    # P6 showed Earned Value and Actual Cost "missing completely" — P6
    # computes both from a resource assignment's own Actual fields, never
    # populated at all before this). Prosota tracks actual cost per
    # ACTIVITY (CostElement.actuals), not per individual resource
    # assignment the way P6 natively does, so a multi-resource activity's
    # one real actuals figure is prorated across its assignments by each
    # one's own share of the activity's total planned cost — see
    # gather_p6_export_data's own comment where this is computed.
    actual_cost: Decimal
    actual_units: Decimal
    actual_start: datetime | None
    actual_finish: datetime | None


@dataclass
class P6BaselineActivity:
    # activity_id: the LIVE activity's own current code (2026-09-06) — not
    # the baseline snapshot's own stale ScheduleBaselineActivity.code,
    # which can be out of date if the activity's been renamed/renumbered
    # since the baseline was captured. Matched against the SAME <Activity
    # Id> this export's own _activity_xml already writes for the live
    # schedule, so P6 can actually link the two back together.
    activity_id: str
    # The SAME numeric ObjectId the live activity gets in <Project><Activity>
    # (both draw from the one task_ids _IdSequence, keyed by the activity's
    # uuid) — omitting it crashed P6's own importer with a
    # NullReferenceException on re-import (2026-09-06), and it's still
    # required even after that first fix (see the fields below).
    id: int
    # name/calendar_id/task_type/status_code: a real P6-generated baseline
    # export always carries the SAME full field set on a <BaselineProject>
    # <Activity> as a live <Project><Activity> does (GUID, CalendarObjectId,
    # DurationType, Status, Type, WBSObjectId, PercentCompleteType, ...) —
    # confirmed against a real reference file's own baseline export. A first
    # fix that only added <ObjectId> still crashed identically on a second
    # real re-import (2026-09-06), so this mirrors that live-activity field
    # set rather than guessing at a narrower one again. Sourced from the
    # LIVE activity's own current values (Prosota's ScheduleBaselineActivity
    # snapshot only ever captured start/finish/duration_hours — there's no
    # "status at baseline time" to draw on), which is fine: P6's own
    # baseline-vs-current comparison is about the snapshotted dates/duration
    # below, not these structural filler fields.
    name: str
    calendar_id: int
    task_type: str
    status_code: str
    wbs_id: int
    guid: str
    start: datetime | None
    finish: datetime | None
    duration_hours: Decimal


@dataclass
class P6Baseline:
    """The project's own currently-assigned schedule baseline (2026-09-06,
    per Maro: re-importing an exported project back into P6 showed BL1
    Start/Finish just mirroring the live dates — this export never wrote a
    <BaselineProject> at all before now). Only the one baseline Activity.
    bl_start/bl_finish already reflects (is_active=True) is exported —
    matching what every other Prosota feature already treats as "the"
    baseline, not the full library of every named snapshot ever captured."""
    object_id: int
    name: str
    data_date: datetime
    activities: list[P6BaselineActivity] = field(default_factory=list)


@dataclass
class P6UdfType:
    id: int
    # PROJWBS | TASK | RSRC — which table this UDF applies to.
    table_name: str
    field_name: str
    label: str
    # P6 logical_data_type (XER) / DataType (XML) — see _udf_data_type.
    data_type: str


@dataclass
class P6UdfValue:
    udf_type_id: int
    # The owning WBS/Task/Resource's own p6 id (fk_id in XER).
    fk_id: int
    text: str | None = None
    number: Decimal | None = None
    date: datetime | None = None


@dataclass
class P6ExportData:
    project_id: int
    project_guid: str
    project_name: str
    data_date: datetime
    plan_start: datetime | None
    calendars: list[P6Calendar] = field(default_factory=list)
    wbs_nodes: list[P6Wbs] = field(default_factory=list)
    activities: list[P6Activity] = field(default_factory=list)
    relationships: list[P6Relationship] = field(default_factory=list)
    resources: list[P6Resource] = field(default_factory=list)
    assignments: list[P6Assignment] = field(default_factory=list)
    udf_types: list[P6UdfType] = field(default_factory=list)
    udf_values: list[P6UdfValue] = field(default_factory=list)
    baseline: P6Baseline | None = None


def _resource_type(resource_type: str) -> str:
    """labour/equipment/crew -> RT_Labor (a crew occupies an activity's time
    the same way labour/equipment does — same reasoning
    resource_costing.py's own compute_assignment_budget already uses),
    material -> RT_Mat, subcontractor/cost -> RT_Labor. The last one isn't a
    guess: every subcontractor resource in the real reference file (e.g.
    "Concrete Foundation Subcontractor") is itself tagged RT_Labor — P6
    users conventionally model subcontractors as labour resources, there's
    no separate native "subcontractor" resource type in P6 at all."""
    if resource_type == "material":
        return "RT_Mat"
    return "RT_Labor"


# PMXML's own <PrimaryConstraintType> values are human-readable strings
# (confirmed real P6 vocabulary, matching e.g. <Status>Not Started</Status>/
# <Type>Task Dependent</Type> just below, which the same file DOES confirm
# directly), not XER's short cstr_type codes — a real 2026-07-16 bug fix:
# this dict used to hold XER-style codes (CS_ALAP etc.) even though only the
# XML exporter ever reads it, so a constrained activity would have written
# an XER code straight into an XML element expecting a real name. Still not
# independently verified against a real *constrained* activity in the
# reference file (every sample TASK row had no constraint set) — if one
# round-trips wrong, this dict is the first place to check.
_CONSTRAINT_TYPE_MAP: dict[str, str] = {
    "alap": "As Late As Possible",
    "snet": "Start On or After",
    "snlt": "Start On or Before",
    "ms": "Mandatory Start",
    "mf": "Mandatory Finish",
    "fnlt": "Finish On or Before",
    "fnet": "Finish On or After",
}


def _status_code(activity: Activity) -> str:
    if activity.actual_finish is not None or (activity.pct_complete is not None and activity.pct_complete >= 100):
        return "TK_Complete"
    if activity.actual_start is not None or (activity.pct_complete is not None and activity.pct_complete > 0):
        return "TK_Active"
    return "TK_NotStart"


def _task_type(activity_type: str) -> str:
    if activity_type == "start_milestone":
        return "TT_Mile"
    if activity_type == "finish_milestone":
        return "TT_FinMile"
    return "TT_Task"


def _udf_data_type(prosota_data_type: str) -> str:
    """Prosota's UserDefinedFieldDefinition.data_type -> P6's UDFTYPE
    logical_data_type. text -> FT_STATICTYPE (P6's own free-text UDF kind —
    confirmed in the real reference file's own UDFTYPE rows, e.g.
    "user_field_462 Safety FT_STATICTYPE"), number/cost -> FT_FLOAT/FT_MONEY,
    integer -> FT_INT, start_date/finish_date -> FT_DATE, indicator has no
    real P6 equivalent captured here (P6's own Indicator UDFs use a fixed
    enum-like set unrelated to Prosota's own 8-state token list) so it falls
    back to FT_STATICTYPE too, same as text — lossy but not wrong: the
    indicator's own label still exports as readable text."""
    return {
        "number": "FT_FLOAT", "integer": "FT_INT", "cost": "FT_MONEY",
        "start_date": "FT_DATE", "finish_date": "FT_DATE",
    }.get(prosota_data_type, "FT_STATICTYPE")


# Sunday=1 .. Saturday=7 (P6's own DayOfWeek numbering, see P6Calendar's own
# header) against Calendar's works_* column names, in that same order.
_P6_DAY_FIELDS: list[tuple[int, str]] = [
    (1, "works_sunday"), (2, "works_monday"), (3, "works_tuesday"), (4, "works_wednesday"),
    (5, "works_thursday"), (6, "works_friday"), (7, "works_saturday"),
]


async def gather_p6_export_data(db: AsyncSession, schedule_period_id: uuid.UUID) -> P6ExportData:
    period = await db.get(SchedulePeriod, schedule_period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Schedule period not found")
    variant = await db.get(ScheduleVariant, period.schedule_variant_id)
    if variant is None:
        raise HTTPException(status_code=404, detail="Schedule variant not found")
    project = await db.get(Project, variant.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    activities_result = await db.execute(
        select(Activity).where(Activity.schedule_period_id == schedule_period_id).order_by(Activity.wbs_path)
    )
    activities = list(activities_result.scalars().all())

    relationships: list[ActivityRelationship] = []
    if activities:
        activity_ids = [a.id for a in activities]
        rel_result = await db.execute(
            select(ActivityRelationship).where(ActivityRelationship.predecessor_id.in_(activity_ids))
        )
        relationships = list(rel_result.scalars().all())

    resources_result = await db.execute(select(Resource).where(Resource.project_id == project.id).order_by(Resource.name))
    resources = list(resources_result.scalars().all())

    assignments: list[ResourceAssignment] = []
    if activities:
        assignments_result = await db.execute(
            select(ResourceAssignment).where(ResourceAssignment.activity_id.in_([a.id for a in activities]))
        )
        assignments = list(assignments_result.scalars().all())

    # Real actual cost per activity, for prorating across its resource
    # assignments below (2026-09-06) — a schedule-linked CostElement's own
    # element_type is always "fixed" (cost_sync.py always creates it that
    # way), so .actuals is already the fully-resolved figure, no percentage/
    # computed_actuals cascade to run first.
    actuals_by_activity_id: dict[uuid.UUID, Decimal] = {}
    if activities:
        actuals_result = await db.execute(
            select(CostElement.linked_activity_id, CostElement.actuals).where(
                CostElement.linked_activity_id.in_([a.id for a in activities]),
                CostElement.source == "schedule",
                CostElement.actuals.is_not(None),
            )
        )
        actuals_by_activity_id = {row.linked_activity_id: row.actuals for row in actuals_result.all()}

    # Every calendar in the project, not just ones actually referenced —
    # simpler than filtering, and _CalendarLookup.resolve already needs the
    # full set to fall back to the project default correctly.
    calendar_lookup = await _build_calendar_lookup(db, project.id)
    calendars_result = await db.execute(select(Calendar).where(Calendar.project_id == project.id).order_by(Calendar.name))
    calendars_raw = list(calendars_result.scalars().all())
    breaks_result = await db.execute(
        select(CalendarBreak).where(CalendarBreak.calendar_id.in_([c.id for c in calendars_raw]))
    )
    breaks_by_calendar: dict[uuid.UUID, list[CalendarBreak]] = {}
    for b in breaks_result.scalars().all():
        breaks_by_calendar.setdefault(b.calendar_id, []).append(b)
    exceptions_result = await db.execute(
        select(CalendarException).where(CalendarException.calendar_id.in_([c.id for c in calendars_raw]))
    )
    exceptions_by_calendar: dict[uuid.UUID, list[CalendarException]] = {}
    for e in exceptions_result.scalars().all():
        exceptions_by_calendar.setdefault(e.calendar_id, []).append(e)

    udf_defs_result = await db.execute(
        select(UserDefinedFieldDefinition).where(
            UserDefinedFieldDefinition.project_id == project.id,
            UserDefinedFieldDefinition.entity_type == "activity",
        )
    )
    udf_defs = list(udf_defs_result.scalars().all())
    udf_values: list[UserDefinedFieldValue] = []
    if udf_defs and activities:
        udf_values_result = await db.execute(
            select(UserDefinedFieldValue).where(
                UserDefinedFieldValue.field_definition_id.in_([d.id for d in udf_defs]),
                UserDefinedFieldValue.record_id.in_([a.id for a in activities]),
            )
        )
        udf_values = list(udf_values_result.scalars().all())

    active_baseline = (await db.execute(
        select(ScheduleBaseline).where(
            ScheduleBaseline.schedule_period_id == schedule_period_id, ScheduleBaseline.is_active.is_(True),
        )
    )).scalar_one_or_none()
    baseline_activities: list[ScheduleBaselineActivity] = []
    if active_baseline is not None:
        baseline_activities_result = await db.execute(
            select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id == active_baseline.id)
        )
        baseline_activities = list(baseline_activities_result.scalars().all())

    # --- ID assignment (see _IdSequence's own header) ---
    calendar_ids = _IdSequence()
    wbs_ids = _IdSequence()
    task_ids = _IdSequence()
    rel_ids = _IdSequence()
    rsrc_ids = _IdSequence()
    assignment_ids = _IdSequence()
    udf_type_ids = _IdSequence()

    out = P6ExportData(
        project_id=1,
        project_guid=_p6_guid(),
        project_name=_sanitize_p6_text(project.name) or project.name,
        data_date=datetime.combine(period.cutoff_date or period.start_date or datetime.now().date(), time(0, 0)),
        plan_start=datetime.combine(period.start_date, time(0, 0)) if period.start_date else None,
    )

    for cal in calendars_raw:
        breaks = [(b.start_time, b.end_time) for b in sorted(breaks_by_calendar.get(cal.id, []), key=lambda b: b.start_time)]
        exceptions = [
            P6CalendarException(
                start_date=datetime.combine(ex.start_date, time(0, 0)),
                end_date=datetime.combine(ex.end_date, time(0, 0)),
                is_working=ex.is_working, start_time=ex.start_time, end_time=ex.end_time,
            )
            for ex in exceptions_by_calendar.get(cal.id, [])
        ]
        out.calendars.append(P6Calendar(
            id=calendar_ids.id_for(cal.id), guid=_p6_guid(), name=cal.name, is_default=cal.is_project_default,
            day_start=cal.day_start_time, day_end=cal.day_end_time,
            works_by_p6_day={p6_day: getattr(cal, field_name) for p6_day, field_name in _P6_DAY_FIELDS},
            breaks=breaks, exceptions=exceptions,
        ))

    # --- WBS structure ---
    # Always one synthetic project-root WBS node named after the project
    # (proj_node_flag=Y in XER terms) rather than conditionally reusing a
    # single top-level wbs_summary activity as the root — simpler and always
    # valid even when a hand-built schedule has several top-level siblings
    # with no single common root (Generate Schedule's own output always has
    # exactly one root today, but nothing enforces that for a manually-built
    # schedule).
    root_wbs_id = wbs_ids.id_for("__project_root__")
    out.wbs_nodes.append(P6Wbs(
        id=root_wbs_id, guid=_p6_guid(), code=out.project_name[:20] or "PROJ", name=out.project_name,
        parent_id=None, seq_num=0, is_project_node=True, commentary=None,
    ))
    # Every WBS node's own (already-sanitized) name, keyed by its p6 id —
    # used below purely to strip a redundant repeat of a storey's own name
    # off the front of its child activities' names (see
    # _strip_redundant_wbs_prefix's own header); not needed for anything
    # else PROJWBS/<WBS> itself writes.
    wbs_name_by_id: dict[int, str] = {root_wbs_id: out.project_name}

    # nearest_wbs_id[a.id] = the p6 wbs id a TASK row (or a nested WBS row's
    # own parent) should reference — its own p6 wbs id if it's itself a
    # wbs_summary, else its nearest wbs_summary ancestor's, else the
    # synthetic root for a top-level non-summary activity.
    activities_by_id = {a.id: a for a in activities}
    nearest_wbs_id: dict[uuid.UUID, int] = {}

    def resolve_nearest_wbs(activity: Activity) -> int:
        if activity.id in nearest_wbs_id:
            return nearest_wbs_id[activity.id]
        if activity.activity_type == "wbs_summary":
            result = wbs_ids.id_for(activity.id)
        elif activity.parent_id is not None and activity.parent_id in activities_by_id:
            result = resolve_nearest_wbs(activities_by_id[activity.parent_id])
        else:
            result = root_wbs_id
        nearest_wbs_id[activity.id] = result
        return result

    for a in activities:
        if a.activity_type != "wbs_summary":
            continue
        parent_wbs_id = (
            resolve_nearest_wbs(activities_by_id[a.parent_id])
            if a.parent_id is not None and a.parent_id in activities_by_id
            else root_wbs_id
        )
        wbs_id = wbs_ids.id_for(a.id)
        wbs_name = _sanitize_p6_text(a.task_name) or a.task_name
        wbs_name_by_id[wbs_id] = wbs_name
        out.wbs_nodes.append(P6Wbs(
            id=wbs_id, guid=_p6_guid(), code=a.code, name=wbs_name,
            parent_id=parent_wbs_id, seq_num=a.sort_order or 0, is_project_node=False,
            commentary=_sanitize_p6_text(a.commentary),
        ))

    # --- Activities (non-wbs_summary rows only) ---
    # p6_activity_by_id: keyed by the SAME task_ids-assigned numeric id, so
    # the baseline block below can pull a baseline activity's structural
    # fields (calendar/task type/status/wbs/guid) straight off its live
    # counterpart rather than re-deriving them a second time.
    p6_activity_by_id: dict[int, P6Activity] = {}
    for a in activities:
        if a.activity_type == "wbs_summary":
            continue
        calendar = calendar_lookup.resolve(a)
        wbs_id = resolve_nearest_wbs(a)
        activity_name = _sanitize_p6_text(a.task_name) or a.task_name
        activity_name = _strip_redundant_wbs_prefix(activity_name, wbs_name_by_id.get(wbs_id, ""))
        p6_activity = P6Activity(
            id=task_ids.id_for(a.id), guid=_p6_guid(), wbs_id=wbs_id,
            calendar_id=calendar_ids.id_for(calendar.id), code=a.code, name=activity_name,
            task_type=_task_type(a.activity_type), status_code=_status_code(a),
            pct_complete=a.pct_complete if a.pct_complete is not None else Decimal(0),
            duration_hours=a.duration_hours if a.duration_hours is not None else Decimal(0),
            start=a.start, finish=a.finish, actual_start=a.actual_start, actual_finish=a.actual_finish,
            total_float_hours=a.total_float_hours, free_float_hours=a.free_float_hours,
            constraint_type=_CONSTRAINT_TYPE_MAP.get(a.constraint_type or ""), constraint_date=a.constraint_date,
            commentary=_sanitize_p6_text(a.commentary),
        )
        out.activities.append(p6_activity)
        p6_activity_by_id[p6_activity.id] = p6_activity

    if active_baseline is not None:
        baseline_activity_xmls: list[P6BaselineActivity] = []
        for sba in baseline_activities:
            # Dropped/archived since the baseline was captured, or a
            # wbs_summary snapshot row — a real BaselineProject only carries
            # genuine Task/Milestone rows as <Activity>; WBS-level snapshots
            # belong in its own <WBS> elements, not built here.
            if sba.activity_id not in activities_by_id:
                continue
            p6_activity = p6_activity_by_id.get(task_ids.id_for(sba.activity_id))
            if p6_activity is None:
                continue
            baseline_activity_xmls.append(P6BaselineActivity(
                activity_id=p6_activity.code, id=p6_activity.id, name=p6_activity.name,
                calendar_id=p6_activity.calendar_id, task_type=p6_activity.task_type,
                status_code=p6_activity.status_code, wbs_id=p6_activity.wbs_id, guid=_p6_guid(),
                start=sba.start, finish=sba.finish,
                duration_hours=sba.duration_hours if sba.duration_hours is not None else Decimal(0),
            ))
        out.baseline = P6Baseline(
            object_id=999_000_001,  # never collides — every other sequence starts from 1
            name=_sanitize_p6_text(active_baseline.name) or active_baseline.name,
            data_date=datetime.combine(active_baseline.baseline_date, time(0, 0)),
            activities=baseline_activity_xmls,
        )

    # --- Relationships ---
    for rel in relationships:
        if rel.predecessor_id not in activities_by_id or rel.successor_id not in activities_by_id:
            continue  # cross-schedule-period reference — shouldn't happen, skip defensively
        out.relationships.append(P6Relationship(
            id=rel_ids.id_for(rel.id), pred_id=task_ids.id_for(rel.predecessor_id),
            succ_id=task_ids.id_for(rel.successor_id),
            type=f"PR_{rel.relationship_type}", lag_hours=rel.lag_hours,
        ))

    # --- Resources + assignments ---
    resources_by_id = {r.id: r for r in resources}
    used_resource_ids = {a.resource_id for a in assignments}
    for r in resources:
        if r.id not in used_resource_ids:
            continue  # export only what's actually assigned somewhere in this schedule
        notes_parts = [p for p in (
            f"Discipline: {r.discipline}" if r.discipline else None,
            f"Company: {r.company}" if r.company else None,
            f"Members: {r.members}" if r.members else None,
        ) if p]
        is_hourly = r.resource_type in ("labour", "equipment", "crew")
        # P6Resource.rate means "price per cost_qty_type unit" everywhere it
        # gets used (RSRCRATE/ResourceRate, below) — Prosota's own rate is a
        # *day* rate for labour/equipment/crew (Resource's own docstring:
        # "rate is a day rate; unit is always 'day'"), so it has to be
        # converted to an hourly-equivalent to stay consistent with
        # cost_qty_type=QT_Hour just below (2026-07-15 fix, caught the same
        # session as the missing RSRCRATE/ResourceRate table itself — an
        # untouched day-rate written in as if it were already hourly would
        # have priced every resource ~8x too high the moment P6 used this
        # rate for anything new). material/subcontractor/cost need no
        # conversion — their own rate is already priced per whatever
        # cost_qty_type=QT_Each means for them (a free-choice unit, or a
        # flat 1x lump sum respectively).
        rate = (r.rate / r.max_hours_per_day) if is_hourly and r.max_hours_per_day else r.rate
        resource_name = _sanitize_p6_text(r.name) or r.name
        rsrc_object_id = rsrc_ids.id_for(r.id)
        # <Id> is P6's own Resource ID/short-code, required unique across its
        # whole resource pool — truncating the resource's real name to 20
        # chars (the old approach) collided whenever two resources shared a
        # >=20-char prefix (2026-07-16, found on the real Snowdon project:
        # names like "Concrete Pour Crew (Footings — Pour Concrete)" and
        # "Concrete Pour Crew (Walls — Pour Concrete)" both truncate to
        # "Concrete Pour Crew (", so P6 silently merged 37 exported resources
        # down to 23, losing the other rates in the process). The full,
        # untruncated name still round-trips correctly via <Name> below —
        # this code only needs to be short and unique, not readable.
        resource_code = f"RES-{rsrc_object_id:04d}"
        out.resources.append(P6Resource(
            id=rsrc_object_id, guid=_p6_guid(), short_name=resource_code, name=resource_name,
            rsrc_type=_resource_type(r.resource_type),
            rate=rate, cost_qty_type="QT_Hour" if is_hourly else "QT_Each",
            calendar_id=calendar_ids.id_for(r.calendar_id) if r.calendar_id else None,
            notes=_sanitize_p6_text("; ".join(notes_parts)) or None,
        ))

    # Pass 1: each assignment's own planned cost/qty, and each ACTIVITY's
    # total planned cost across all its assignments (the denominator the
    # proration below needs) — computed first since an activity's total
    # isn't known until every one of its assignments has been costed.
    valid_assignments = [
        asg for asg in assignments
        if asg.activity_id in activities_by_id and asg.resource_id in resources_by_id
    ]
    costed: dict[uuid.UUID, tuple[Decimal, Decimal, Decimal]] = {}  # assignment id -> (cost, qty, cost_per_qty)
    planned_total_by_activity_id: dict[uuid.UUID, Decimal] = {}
    for asg in valid_assignments:
        activity = activities_by_id[asg.activity_id]
        resource = resources_by_id[asg.resource_id]
        # Exact hours_per_day, not activity.duration_days' own rounded
        # display value (2026-09-05, per Maro: "time is costed by the hour"
        # — see compute_assignment_budget's own header).
        export_hours_per_day = calendar_lookup.hours_per_day(calendar_lookup.resolve(activity))
        cost = resource_costing.compute_assignment_budget(resource, activity, asg, export_hours_per_day)
        # Same shared formula Prosota's own budget reads from (never a
        # second, hand-rolled copy) — for a labour/equipment/crew
        # assignment this is duration_hours-in-days x utilisation_pct/100,
        # UNLESS asg.planned_hours is set (a P6-imported exact hours
        # figure this assignment hasn't been hand-edited since), in which
        # case it's planned_hours/hours_per_day instead — see
        # resource_costing._labour_days's own header.
        qty = resource_costing.compute_assignment_rate_line_qty(resource, activity, asg, export_hours_per_day)
        cost_per_qty = (cost / qty) if qty else cost
        costed[asg.id] = (cost, qty, cost_per_qty)
        planned_total_by_activity_id[asg.activity_id] = planned_total_by_activity_id.get(asg.activity_id, Decimal(0)) + cost

    # Pass 2: prorate each activity's one real actuals figure across its
    # assignments by their own share of that activity's total planned cost
    # — the closest honest approximation available, since Prosota tracks
    # actual cost per ACTIVITY, not per individual resource assignment the
    # way P6 natively does (see P6Assignment.actual_cost's own header).
    for asg in valid_assignments:
        activity = activities_by_id[asg.activity_id]
        cost, qty, cost_per_qty = costed[asg.id]
        activity_actuals = actuals_by_activity_id.get(asg.activity_id)
        activity_planned_total = planned_total_by_activity_id.get(asg.activity_id) or Decimal(0)
        if activity_actuals is not None and activity_planned_total != 0:
            actual_cost = activity_actuals * (cost / activity_planned_total)
        else:
            actual_cost = Decimal(0)
        actual_units = (actual_cost / cost_per_qty) if cost_per_qty else Decimal(0)
        # Only stamp Actual dates once there's real actual cost — an
        # assignment with none hasn't actually started yet, regardless of
        # what the activity's own (possibly forecast) start/finish say.
        has_actuals = activity_actuals is not None and activity_actuals != 0
        out.assignments.append(P6Assignment(
            id=assignment_ids.id_for(asg.id), task_id=task_ids.id_for(asg.activity_id),
            rsrc_id=rsrc_ids.id_for(asg.resource_id), qty=qty, cost_per_qty=cost_per_qty, cost=cost,
            actual_cost=actual_cost, actual_units=actual_units,
            actual_start=activity.actual_start if has_actuals else None,
            actual_finish=activity.actual_finish if has_actuals else None,
        ))

    # --- UDFs ---
    udf_type_p6_id_by_def_id: dict[uuid.UUID, int] = {}
    for d in udf_defs:
        p6_id = udf_type_ids.id_for(d.id)
        udf_type_p6_id_by_def_id[d.id] = p6_id
        out.udf_types.append(P6UdfType(id=p6_id, table_name="TASK", field_name=f"user_field_{p6_id}", label=d.name, data_type=_udf_data_type(d.data_type)))
    defs_by_id = {d.id: d for d in udf_defs}
    for v in udf_values:
        definition = defs_by_id.get(v.field_definition_id)
        if definition is None or v.record_id not in activities_by_id:
            continue
        activity = activities_by_id[v.record_id]
        if activity.activity_type == "wbs_summary":
            continue  # this pass only carries UDFs onto real TASK rows
        out.udf_values.append(P6UdfValue(
            udf_type_id=udf_type_p6_id_by_def_id[definition.id], fk_id=task_ids.id_for(v.record_id),
            text=v.value_text if definition.data_type not in ("number", "integer", "cost") else None,
            number=v.value_number, date=v.value_date,
        ))

    return out
