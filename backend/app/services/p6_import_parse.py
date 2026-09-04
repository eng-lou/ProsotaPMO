from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException

# Same namespace p6_export_xml.py writes — confirmed against two real files
# (the original EC00610 - B1.xml reference and P6's own re-export of a
# Prosota-generated schedule, Snowdon-3.xml) that this doesn't vary by P6
# version in a way that would break a fixed namespace string; if a future
# file uses a different version number in the URI, this needs widening to a
# version-agnostic match rather than a hardcoded string.
_NS = "http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects"


def _tag(name: str) -> str:
    return f"{{{_NS}}}{name}"


def _text(el: ET.Element | None, name: str) -> str | None:
    if el is None:
        return None
    child = el.find(_tag(name))
    if child is None or child.text is None:
        return None
    return child.text


def _finish_time(el: ET.Element | None, name: str) -> time | None:
    """A WorkTime <Finish> is P6's own last *inclusive* working minute, not
    an exclusive boundary — confirmed against a real file: every single
    <Finish> across all 3 calendars ends in ":59" (11:59/15:59/16:59),
    against Start times always exactly on the hour, and each calendar's own
    <HoursPerDay> only comes out to its stated round number once each
    Finish is read as "+1 minute" (e.g. 08:00-11:59 + 13:00-16:59, read
    literally, nets 7h58m against a calendar declaring 8 — treating Finish
    as inclusive gives the intended clean 08:00-12:00 + 13:00-17:00 = 8h
    exactly). 2026-09-04, found chasing a real BAC/duration discrepancy
    against P6's own report (Maro: "fix that rounding gap") — this was
    the actual source, not a genuine rounding artifact: every calendar
    Prosota imported was silently running ~2 minutes/day short of what P6
    itself considers a working day, which understated every resource's
    day-rate conversion and every duration-to-days calculation by the same
    small amount."""
    raw = _text(el, name)
    if raw is None:
        return None
    t = time.fromisoformat(raw)
    total_minutes = t.hour * 60 + t.minute + 1
    if total_minutes >= 24 * 60:
        return time(23, 59)  # never actually reached by a real work-day boundary; just a safe clamp
    return time(total_minutes // 60, total_minutes % 60, t.second)


def _decimal(el: ET.Element | None, name: str) -> Decimal | None:
    raw = _text(el, name)
    if raw is None:
        return None
    try:
        return Decimal(raw)
    except InvalidOperation:
        return None


def _datetime(el: ET.Element | None, name: str) -> datetime | None:
    raw = _text(el, name)
    if raw is None:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


@dataclass
class ParsedCalendarException:
    start_date: date
    end_date: date
    is_working: bool
    start_time: time | None
    end_time: time | None


@dataclass
class ParsedCalendar:
    object_id: str
    name: str
    is_default: bool
    # A single representative working day's own envelope — derived from
    # whichever weekday has the most WorkTime segments (an unusual real
    # calendar could vary genuinely by weekday; Prosota's own Calendar model
    # has no way to express that, so this picks one representative day
    # rather than silently averaging or picking arbitrarily the first one
    # found, which could land on a day with only a partial pattern).
    day_start: time
    day_end: time
    breaks: list[tuple[time, time]]
    works: dict[int, bool]  # P6 day-of-week 1..7 (Sunday..Saturday) -> working
    exceptions: list[ParsedCalendarException]


@dataclass
class ParsedWbs:
    object_id: str
    parent_object_id: str | None
    name: str
    code: str
    commentary: str | None


@dataclass
class ParsedUdfValue:
    udf_type_object_id: str
    text: str | None = None
    number: Decimal | None = None
    date_value: datetime | None = None


@dataclass
class ParsedActivity:
    object_id: str
    wbs_object_id: str | None
    calendar_object_id: str | None
    code: str
    name: str
    activity_type: str  # task | start_milestone | finish_milestone
    duration_hours: Decimal
    start: datetime | None
    finish: datetime | None
    actual_start: datetime | None
    actual_finish: datetime | None
    pct_complete: Decimal
    constraint_type: str | None  # Prosota's own asap/alap/snet/... code, already reverse-mapped
    constraint_date: datetime | None
    commentary: str | None
    udf_values: list[ParsedUdfValue]


@dataclass
class ParsedRelationship:
    predecessor_object_id: str
    successor_object_id: str
    relationship_type: str  # FS | SS | FF | SF
    lag_hours: Decimal


@dataclass
class ParsedResource:
    object_id: str
    name: str
    resource_type: str  # Prosota's labour/material/equipment
    calendar_object_id: str | None
    # Resolved from the matching top-level <ResourceRate> after both are
    # gathered (a resource with no rate row at all just gets rate=0, same
    # "leave it blank rather than fake a number" pattern the rest of this
    # app already follows — see p6_import.py's own header). is_hourly says
    # whether this needs day-rate conversion on the way into Prosota's own
    # Resource.rate (labour/equipment types are priced per hour in P6,
    # Prosota prices them per day).
    rate_per_unit: Decimal | None = None
    is_hourly: bool = True


@dataclass
class ParsedAssignment:
    activity_object_id: str
    resource_object_id: str
    planned_units: Decimal  # hours (labour/equipment) or a plain quantity (material)


@dataclass
class ParsedUdfType:
    object_id: str
    subject_area: str  # Activity | WBS | Resource (P6's own <SubjectArea> value)
    title: str
    data_type: str  # Prosota's own text/number/integer/cost/start_date/finish_date


@dataclass
class ParsedBaselineActivity:
    # Matched back to a real imported Activity by this P6 Activity Id text
    # (e.g. "EC2430"), NOT by ObjectId — a <BaselineProject>'s own nested
    # <Activity> elements carry entirely different ObjectIds from the live
    # project's own (confirmed against a real file: the live project and
    # each of its baselines are separate P6 "projects" internally, each
    # numbering their own objects independently), but P6 keeps the
    # human-readable Activity Id stable across a project and its baselines.
    p6_activity_id: str
    start: datetime | None
    finish: datetime | None
    duration_hours: Decimal


@dataclass
class ParsedBaseline:
    # BaselineTypeName ("Customer Sign-Off Baseline") is the label P6's own
    # UI and export dialog show the user — preferred over the baseline
    # project's own <Name> (e.g. "Saratoga Senior Community - B2"), which is
    # just the live project's name with a suffix, far less recognisable.
    name: str
    data_date: date | None
    activities: list[ParsedBaselineActivity] = field(default_factory=list)


@dataclass
class ParsedP6Schedule:
    project_name: str
    data_date: date | None = None
    calendars: list[ParsedCalendar] = field(default_factory=list)
    wbs_nodes: list[ParsedWbs] = field(default_factory=list)
    activities: list[ParsedActivity] = field(default_factory=list)
    relationships: list[ParsedRelationship] = field(default_factory=list)
    resources: list[ParsedResource] = field(default_factory=list)
    assignments: list[ParsedAssignment] = field(default_factory=list)
    udf_types: list[ParsedUdfType] = field(default_factory=list)
    baselines: list[ParsedBaseline] = field(default_factory=list)
    # Human-readable notes on anything the file contained that Prosota has
    # no model for, or a real file's actual values genuinely couldn't be
    # mapped cleanly — surfaced in the import summary rather than silently
    # dropped (same "unmatched_codes" transparency pattern
    # schedule_variant.py's own promote_variant already established).
    skipped: list[str] = field(default_factory=list)


_DAY_NAME_TO_P6_DAY = {
    "Sunday": 1, "Monday": 2, "Tuesday": 3, "Wednesday": 4, "Thursday": 5, "Friday": 6, "Saturday": 7,
}

# Reverse of p6_export_xml.py's own _TASK_TYPE_NAMES/_RELATIONSHIP_TYPE_NAMES/
# _RESOURCE_TYPE_NAMES/p6_export.py's _CONSTRAINT_TYPE_MAP — same real PMXML
# vocabulary, just read instead of written. Any <Type>/<ResourceType>/
# <PrimaryConstraintType> value not in these maps falls back to a sane
# default and gets a note in `skipped` rather than raising — a real external
# P6 file (unlike our own round-tripped export) can use activity types this
# app has no equivalent for at all.
#
# P6's own "WBS Summary" here is an ACTIVITY type (Activity/Type ==
# "WBS Summary") — a real leaf Activity row that behaves like an umbrella/
# roll-up task, entirely distinct from a structural <WBS> element (2026-09-04,
# per Maro: "in P6 wbs summary is just an umbrella like task... In our own
# platform its like an actual wbs, P6 has wbs and wbs summary separate, one
# is a wbs node and the other is summary task"). Confusingly, Prosota's OWN
# activity_type == "wbs_summary" means something closer to P6's plain <WBS>
# node (a structural row auto-promoted because it has children) — a
# different, unrelated concept from this one despite the shared name. There
# is no Prosota row type that behaves like P6's roll-up-bar activity, so
# (same as Level of Effort above) it maps to a plain task — better than the
# old fallback, which treated an unrecognised "WBS Summary" *type name* as
# genuinely unsupported and flagged every one of them in `skipped`.
_ACTIVITY_TYPE_BY_NAME = {
    "Task Dependent": "task", "Resource Dependent": "task", "Level of Effort": "task", "WBS Summary": "task",
    "Start Milestone": "start_milestone", "Finish Milestone": "finish_milestone",
}
_RELATIONSHIP_TYPE_BY_NAME = {
    "Finish to Start": "FS", "Start to Start": "SS", "Finish to Finish": "FF", "Start to Finish": "SF",
}
_RESOURCE_TYPE_BY_NAME = {"Labor": "labour", "Material": "material", "Nonlabor": "equipment"}
_CONSTRAINT_TYPE_BY_NAME = {
    "As Late As Possible": "alap", "Start On or After": "snet", "Start On or Before": "snlt",
    "Mandatory Start": "ms", "Mandatory Finish": "mf", "Finish On or Before": "fnlt", "Finish On or After": "fnet",
}


def _parse_calendar(el: ET.Element, skipped: list[str]) -> ParsedCalendar:
    object_id = _text(el, "ObjectId") or ""
    works: dict[int, bool] = {}
    day_windows: dict[int, list[tuple[time, time]]] = {}
    week = el.find(_tag("StandardWorkWeek"))
    if week is not None:
        for day_el in week.findall(_tag("StandardWorkHours")):
            day_name = _text(day_el, "DayOfWeek") or ""
            p6_day = _DAY_NAME_TO_P6_DAY.get(day_name)
            if p6_day is None:
                continue
            segments = [
                (time.fromisoformat(_text(wt, "Start") or "00:00:00"), _finish_time(wt, "Finish") or time(0, 0))
                for wt in day_el.findall(_tag("WorkTime"))
                if _text(wt, "Start") is not None
            ]
            works[p6_day] = len(segments) > 0
            if segments:
                day_windows[p6_day] = sorted(segments, key=lambda s: s[0])

    # Representative day — whichever working day has the most segments
    # (most likely to include a lunch-break split, so its own breaks are
    # captured rather than picking a day that happens to have none).
    if day_windows:
        rep_day = max(day_windows, key=lambda d: len(day_windows[d]))
        rep_segments = day_windows[rep_day]
        day_start = rep_segments[0][0]
        day_end = rep_segments[-1][1]
        breaks = [(rep_segments[i][1], rep_segments[i + 1][0]) for i in range(len(rep_segments) - 1)]
    else:
        day_start, day_end, breaks = time(8, 0), time(17, 0), []
        skipped.append(f"Calendar '{_text(el, 'Name')}' has no working days at all — defaulted to 08:00-17:00 Mon-Fri.")

    exceptions: list[ParsedCalendarException] = []
    exceptions_el = el.find(_tag("HolidayOrExceptions"))
    if exceptions_el is not None:
        for ex_el in exceptions_el.findall(_tag("HolidayOrException")):
            d = _datetime(ex_el, "Date")
            if d is None:
                continue
            wt = ex_el.find(_tag("WorkTime"))
            is_working = wt is not None and _text(wt, "Start") is not None
            exceptions.append(ParsedCalendarException(
                start_date=d.date(), end_date=d.date(), is_working=is_working,
                start_time=time.fromisoformat(_text(wt, "Start") or "00:00:00") if is_working else None,
                end_time=(_finish_time(wt, "Finish") or time(0, 0)) if is_working else None,
            ))

    return ParsedCalendar(
        object_id=object_id, name=_text(el, "Name") or "Imported Calendar",
        is_default=_text(el, "IsDefault") == "1",
        day_start=day_start, day_end=day_end, breaks=breaks, works=works, exceptions=exceptions,
    )


def _parse_udf_value(udf_el: ET.Element) -> ParsedUdfValue | None:
    type_object_id = _text(udf_el, "TypeObjectId")
    if type_object_id is None:
        return None
    text = _text(udf_el, "TextValue")
    if text is not None:
        return ParsedUdfValue(udf_type_object_id=type_object_id, text=text)
    number = _decimal(udf_el, "NumericValue")
    if number is not None:
        return ParsedUdfValue(udf_type_object_id=type_object_id, number=number)
    date_value = _datetime(udf_el, "DateValue")
    if date_value is not None:
        return ParsedUdfValue(udf_type_object_id=type_object_id, date_value=date_value)
    # <IndicatorValue> (a fixed enum-like token, e.g. "Green"/"Yellow") has
    # no clean Prosota equivalent to round-trip into (its own 8-state
    # indicator set is a different vocabulary) — carried through as plain
    # text, same "lossy but not wrong, still readable" choice
    # p6_export.py's own _udf_data_type makes for the same field going the
    # other direction.
    indicator = _text(udf_el, "IndicatorValue")
    if indicator is not None:
        return ParsedUdfValue(udf_type_object_id=type_object_id, text=indicator)
    return None


def _parse_activity(el: ET.Element, skipped: list[str]) -> ParsedActivity:
    type_name = _text(el, "Type") or "Task Dependent"
    activity_type = _ACTIVITY_TYPE_BY_NAME.get(type_name)
    if activity_type is None:
        activity_type = "task"
        skipped.append(f"Activity '{_text(el, 'Name')}' has unsupported Type \"{type_name}\" — imported as a plain task.")

    constraint_name = _text(el, "PrimaryConstraintType")
    constraint_type = _CONSTRAINT_TYPE_BY_NAME.get(constraint_name) if constraint_name else None
    if constraint_name and constraint_type is None:
        skipped.append(f"Activity '{_text(el, 'Name')}' has unsupported constraint \"{constraint_name}\" — imported with no constraint.")

    udf_values = [v for v in (_parse_udf_value(u) for u in el.findall(_tag("UDF"))) if v is not None]

    return ParsedActivity(
        object_id=_text(el, "ObjectId") or "", wbs_object_id=_text(el, "WBSObjectId"),
        calendar_object_id=_text(el, "CalendarObjectId"),
        code=_text(el, "Id") or "", name=_text(el, "Name") or "Imported Activity",
        activity_type=activity_type, duration_hours=_decimal(el, "PlannedDuration") or Decimal(0),
        start=_datetime(el, "StartDate") or _datetime(el, "PlannedStartDate"),
        finish=_datetime(el, "FinishDate") or _datetime(el, "PlannedFinishDate"),
        actual_start=_datetime(el, "ActualStartDate"), actual_finish=_datetime(el, "ActualFinishDate"),
        # P6's own <PercentComplete> is a 0-1 fraction (confirmed against a
        # real file: values like 0.2/0.82/0.9/0.92 alongside plain 0/1),
        # not Prosota's own 0-100 scale — 2026-09-04, found chasing a real
        # PV discrepancy Maro caught (this specific field wasn't actually
        # the cause that time, since p6_import.py's own progress-layering
        # overwrites it anyway, but it's a real, separate correctness bug
        # for any straight PMXML import with no such follow-up: an activity
        # genuinely 82% complete was landing as 0.82%). p6_export_xml.py's
        # own writer has the matching /100 fix — this bug was invisible to
        # the round-trip tests because both sides used the same wrong
        # scale, cancelling out; only importing a real external file (which
        # correctly follows the true 0-1 convention) exposed it.
        pct_complete=(_decimal(el, "PercentComplete") or Decimal(0)) * 100,
        constraint_type=constraint_type, constraint_date=_datetime(el, "PrimaryConstraintDate"),
        commentary=_text(el, "Notes"), udf_values=udf_values,
    )


def parse_pmxml(data: bytes) -> ParsedP6Schedule:
    """Parses raw PMXML bytes into an intermediate structure — pure parsing,
    no DB access, so a malformed/unsupported file fails cleanly (422) before
    p6_import.py ever opens a transaction. See this module's own header for
    the structural facts (Calendar/Resource top-level, WBS/Activity/
    Relationship/ResourceAssignment nested inside <Project>) confirmed
    directly against real P6 files while building the export side."""
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise HTTPException(status_code=422, detail=f"Not a well-formed XML file: {exc}") from exc

    project_els = root.findall(_tag("Project"))
    if not project_els:
        raise HTTPException(status_code=422, detail="No <Project> element found — not a recognisable PMXML export.")
    project_el = project_els[0]
    skipped: list[str] = []
    if len(project_els) > 1:
        skipped.append(f"File contains {len(project_els)} projects — only the first (\"{_text(project_el, 'Id')}\") was imported.")

    # Real Name ("Saratoga Senior Community") preferred over Id ("EC00630")
    # — the Id is P6's own short project code, not what the user would
    # recognise the project as (2026-09-03, per Maro: "the Project Name
    # wasn't captured" — Id was being used everywhere Name should have
    # been). DataDate is P6's own live "as-of" date for the whole schedule
    # — falls back to PlannedStartDate for a file that somehow lacks it
    # (never actually seen, but PlannedStartDate is the closest analogue).
    project_data_date = _datetime(project_el, "DataDate") or _datetime(project_el, "PlannedStartDate")
    out = ParsedP6Schedule(
        project_name=_text(project_el, "Name") or _text(project_el, "Id") or "Imported Project",
        data_date=project_data_date.date() if project_data_date else None,
        skipped=skipped,
    )

    for cal_el in root.findall(_tag("Calendar")):
        out.calendars.append(_parse_calendar(cal_el, skipped))

    # A real P6 file routinely writes <IsDefault>0</IsDefault> on every
    # single <Calendar> (confirmed against a real export — none ever set to
    # 1), so is_default off that field alone left every imported calendar
    # non-default and p6_import.py's own "first created calendar becomes
    # default" fallback picked whichever happened to be listed first in the
    # file — right by coincidence for a file where that's also the one
    # every activity actually uses, wrong in general (2026-09-04, per Maro:
    # "you still use the default prosota calendar when you should be using
    # everything from the imported dataset"). <Project>'s own
    # ActivityDefaultCalendarObjectId is P6's real authoritative signal for
    # this — every activity's own CalendarObjectId in this file matched it
    # exactly.
    default_calendar_object_id = _text(project_el, "ActivityDefaultCalendarObjectId")
    if default_calendar_object_id is not None:
        for c in out.calendars:
            if c.object_id == default_calendar_object_id:
                c.is_default = True

    rates_by_resource: dict[str, Decimal] = {}
    for rate_el in root.findall(_tag("ResourceRate")):
        resource_object_id = _text(rate_el, "ResourceObjectId")
        price = _decimal(rate_el, "PricePerUnit")
        if resource_object_id is not None and price is not None:
            # A resource can carry several dated rates (rate history) —
            # takes the last one found, same "one current rate, not a
            # history" simplification p6_export.py's own RSRCRATE/
            # ResourceRate writer already makes for the opposite direction.
            rates_by_resource[resource_object_id] = price

    for rsrc_el in root.findall(_tag("Resource")):
        type_name = _text(rsrc_el, "ResourceType") or "Labor"
        resource_type = _RESOURCE_TYPE_BY_NAME.get(type_name)
        if resource_type is None:
            resource_type = "labour"
            skipped.append(f"Resource '{_text(rsrc_el, 'Name')}' has unsupported ResourceType \"{type_name}\" — imported as labour.")
        object_id = _text(rsrc_el, "ObjectId") or ""
        out.resources.append(ParsedResource(
            object_id=object_id, name=_text(rsrc_el, "Name") or "Imported Resource",
            resource_type=resource_type, calendar_object_id=_text(rsrc_el, "CalendarObjectId"),
            rate_per_unit=rates_by_resource.get(object_id), is_hourly=resource_type != "material",
        ))

    for udf_type_el in root.findall(_tag("UDFType")):
        subject_area = _text(udf_type_el, "SubjectArea") or "Activity"
        data_type_name = _text(udf_type_el, "DataType") or "Text"
        data_type = {"Double": "number", "Integer": "integer", "Cost": "cost", "Date": "start_date"}.get(data_type_name, "text")
        out.udf_types.append(ParsedUdfType(
            object_id=_text(udf_type_el, "ObjectId") or "", subject_area=subject_area,
            title=_text(udf_type_el, "Title") or "Imported Field", data_type=data_type,
        ))

    for wbs_el in project_el.findall(_tag("WBS")):
        out.wbs_nodes.append(ParsedWbs(
            object_id=_text(wbs_el, "ObjectId") or "", parent_object_id=_text(wbs_el, "ParentObjectId"),
            name=_text(wbs_el, "Name") or "Imported WBS", code=_text(wbs_el, "Code") or "",
            commentary=_text(wbs_el, "Description"),
        ))

    for activity_el in project_el.findall(_tag("Activity")):
        out.activities.append(_parse_activity(activity_el, skipped))

    for rel_el in project_el.findall(_tag("Relationship")):
        pred = _text(rel_el, "PredecessorActivityObjectId")
        succ = _text(rel_el, "SuccessorActivityObjectId")
        if pred is None or succ is None:
            continue
        type_name = _text(rel_el, "Type") or "Finish to Start"
        rel_type = _RELATIONSHIP_TYPE_BY_NAME.get(type_name)
        if rel_type is None:
            rel_type = "FS"
            skipped.append(f"A relationship has unsupported Type \"{type_name}\" — imported as Finish-to-Start.")
        out.relationships.append(ParsedRelationship(
            predecessor_object_id=pred, successor_object_id=succ,
            relationship_type=rel_type, lag_hours=_decimal(rel_el, "Lag") or Decimal(0),
        ))

    for asg_el in project_el.findall(_tag("ResourceAssignment")):
        activity_object_id = _text(asg_el, "ActivityObjectId")
        resource_object_id = _text(asg_el, "ResourceObjectId")
        if activity_object_id is None or resource_object_id is None:
            continue
        out.assignments.append(ParsedAssignment(
            activity_object_id=activity_object_id, resource_object_id=resource_object_id,
            planned_units=_decimal(asg_el, "PlannedUnits") or Decimal(0),
        ))

    # --- Baselines: each is its own <BaselineProject>, a full sibling
    # structure to <Project> (not nested inside it) carrying its own nested
    # <Activity> elements — confirmed against a real two-baseline export
    # (EC00630.xml, 2026-09-03). OriginalProjectObjectId is how a baseline
    # says which live project it was captured from; only baselines pointing
    # at *this* file's own <Project> are imported (a multi-project PMXML
    # export could in principle carry baselines for projects other than the
    # one being imported here).
    project_object_id = _text(project_el, "ObjectId")
    for bp_el in root.findall(_tag("BaselineProject")):
        if _text(bp_el, "OriginalProjectObjectId") != project_object_id:
            continue
        bp_data_date = _datetime(bp_el, "DataDate")
        baseline = ParsedBaseline(
            name=_text(bp_el, "BaselineTypeName") or _text(bp_el, "Name") or "Imported Baseline",
            data_date=bp_data_date.date() if bp_data_date else None,
        )
        for bact_el in bp_el.findall(_tag("Activity")):
            p6_activity_id = _text(bact_el, "Id")
            if p6_activity_id is None:
                continue
            baseline.activities.append(ParsedBaselineActivity(
                p6_activity_id=p6_activity_id,
                start=_datetime(bact_el, "StartDate") or _datetime(bact_el, "PlannedStartDate"),
                finish=_datetime(bact_el, "FinishDate") or _datetime(bact_el, "PlannedFinishDate"),
                duration_hours=_decimal(bact_el, "PlannedDuration") or Decimal(0),
            ))
        out.baselines.append(baseline)

    return out
