from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from xml.sax.saxutils import escape

from app.services.p6_export import P6ExportData

_XMLNS = "http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects"
_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]  # P6 day 1..7

# Real PMXML relationship type names, confirmed directly against the
# reference file's own <Relationship><Type> values ("Finish to Start" for a
# PR_FS row) — not guessed from the XER short codes alone.
_RELATIONSHIP_TYPE_NAMES = {
    "FS": "Finish to Start", "SS": "Start to Start", "FF": "Finish to Finish", "SF": "Start to Finish",
}

# Real PMXML resource type names, confirmed against the reference file's own
# <Resource><ResourceType>Labor</ResourceType>.
_RESOURCE_TYPE_NAMES = {"RT_Labor": "Labor", "RT_Mat": "Material", "RT_Equip": "Nonlabor"}


def _fmt_datetime(dt: datetime | None) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S") if dt is not None else ""


def _fmt_time(t) -> str:  # noqa: ANN001 — datetime.time
    return t.strftime("%H:%M:%S")


def _fmt_dec(value: Decimal | None, places: int = 2) -> str:
    return "" if value is None else f"{float(value):.{places}f}"


def _el(tag: str, value: str | None) -> str:
    """A single leaf element — xsi:nil for a genuinely absent value (P6's
    own convention for every optional field in the reference file, e.g.
    `<ActualFinishDate xsi:nil="true" />`), otherwise XML-escaped text
    content. CDATA is deliberately NOT used here even though the reference
    file wraps a couple of fields (Project/Activity `<Id>`) in CDATA — plain
    escaping is just as valid XML and avoids CDATA's own "]]>" edge case for
    free-text fields like commentary that could contain anything."""
    if value is None or value == "":
        return f'<{tag} xsi:nil="true" />'
    return f"<{tag}>{escape(value)}</{tag}>"


def _guid_braces() -> str:
    return "{" + str(uuid.uuid4()).upper() + "}"


def _udf_value_element(v) -> str:  # noqa: ANN001 — p6_export.P6UdfValue
    """Which <UDF> child holds the value depends on the field's own data
    type — <IndicatorValue> is directly confirmed against the reference
    file's own embedded WBS UDF ("Cost Performance" -> Green/Yellow);
    <TextValue>/<NumericValue>/<DateValue> follow the same documented PMXML
    UDF schema shape but aren't independently confirmed against a real
    sample of each (the reference file's own UDFs happened to all be
    Indicator-typed) — same caveat as p6_export.py's own
    _CONSTRAINT_TYPE_MAP."""
    if v.text is not None:
        return _el("TextValue", v.text)
    if v.number is not None:
        return _el("NumericValue", _fmt_dec(v.number, 4))
    if v.date is not None:
        return _el("DateValue", _fmt_datetime(v.date))
    return ""


def _calendar_xml(c) -> str:  # noqa: ANN001 — p6_export.P6Calendar
    day_blocks = []
    for p6_day in range(1, 8):
        working = c.works_by_p6_day.get(p6_day, False)
        work_times = ""
        if working:
            breaks_sorted = sorted(c.breaks, key=lambda b: b[0])
            bounds = [c.day_start]
            for b_start, b_end in breaks_sorted:
                bounds.extend([b_start, b_end])
            bounds.append(c.day_end)
            for i in range(0, len(bounds), 2):
                seg_start, seg_end = bounds[i], bounds[i + 1]
                if seg_end > seg_start:
                    work_times += f"<WorkTime><Start>{_fmt_time(seg_start)}</Start><Finish>{_fmt_time(seg_end)}</Finish></WorkTime>"
        else:
            work_times = '<WorkTime xsi:nil="true" />'
        day_blocks.append(f"<StandardWorkHours><DayOfWeek>{_DAY_NAMES[p6_day - 1]}</DayOfWeek>{work_times}</StandardWorkHours>")

    exceptions_xml = []
    for ex in c.exceptions:
        d = ex.start_date.date()
        end = ex.end_date.date()
        while d <= end:
            if ex.is_working:
                start = ex.start_time or c.day_start
                finish = ex.end_time or c.day_end
                wt = f"<WorkTime><Start>{_fmt_time(start)}</Start><Finish>{_fmt_time(finish)}</Finish></WorkTime>"
            else:
                wt = '<WorkTime xsi:nil="true" />'
            exceptions_xml.append(f'<HolidayOrException><Date>{d.strftime("%Y-%m-%dT00:00:00")}</Date>{wt}</HolidayOrException>')
            d = d.fromordinal(d.toordinal() + 1)

    return (
        f"<Calendar>"
        f"<HoursPerDay>{_fmt_dec(_hours_per_day(c), 2)}</HoursPerDay>"
        f"<IsDefault>{1 if c.is_default else 0}</IsDefault>"
        f"<IsPersonal>0</IsPersonal>"
        f"{_el('Name', c.name)}"
        f"<ObjectId>{c.id}</ObjectId>"
        f'<ProjectObjectId xsi:nil="true" />'
        f"<Type>Global</Type>"
        f"<StandardWorkWeek>{''.join(day_blocks)}</StandardWorkWeek>"
        f"<HolidayOrExceptions>{''.join(exceptions_xml)}</HolidayOrExceptions>"
        f"</Calendar>"
    )


def _hours_per_day(c) -> Decimal:  # noqa: ANN001
    start_minutes = c.day_start.hour * 60 + c.day_start.minute
    end_minutes = c.day_end.hour * 60 + c.day_end.minute
    break_minutes = sum(
        (b_end.hour * 60 + b_end.minute) - (b_start.hour * 60 + b_start.minute) for b_start, b_end in c.breaks
    )
    return Decimal(max(0, end_minutes - start_minutes - break_minutes)) / Decimal(60)


# Full field set + real alphabetical order, both taken verbatim from the
# reference file's own <Resource> element (2026-07-15 fix, per Maro: "xml
# import works, activities and relationships transferred well. but
# resources/costs did not" — same root cause class as the XER PROJECT-grid
# fix just above: a trimmed field set that "worked" for other element types
# evidently doesn't for Resource. xsi:nil placeholders for every field
# Prosota has no data for, rather than omitting the element entirely.
def _resource_xml(r) -> str:  # noqa: ANN001 — p6_export.P6Resource
    return (
        f"<Resource>"
        f"<AutoComputeActuals>0</AutoComputeActuals>"
        f"<CalculateCostFromUnits>1</CalculateCostFromUnits>"
        f"{f'<CalendarObjectId>{r.calendar_id}</CalendarObjectId>' if r.calendar_id is not None else '<CalendarObjectId xsi:nil=\"true\" />'}"
        f"<CurrencyObjectId>1</CurrencyObjectId>"
        f"<DefaultUnitsPerTime>1</DefaultUnitsPerTime>"
        f'<EmailAddress xsi:nil="true" />'
        f'<EmployeeId xsi:nil="true" />'
        f"<GUID>{r.guid}</GUID>"
        f"{_el('Id', r.short_name)}"
        f"<IsActive>1</IsActive>"
        f"<IsOverTimeAllowed>0</IsOverTimeAllowed>"
        f"{_el('Name', r.name)}"
        f"<ObjectId>{r.id}</ObjectId>"
        f'<OfficePhone xsi:nil="true" />'
        f'<OtherPhone xsi:nil="true" />'
        f"<OvertimeFactor>0</OvertimeFactor>"
        f'<ParentObjectId xsi:nil="true" />'
        f'<PrimaryRoleObjectId xsi:nil="true" />'
        f"{_el('ResourceNotes', r.notes)}"
        f"<ResourceType>{_RESOURCE_TYPE_NAMES.get(r.rsrc_type, 'Labor')}</ResourceType>"
        f"<SequenceNumber>{r.id}</SequenceNumber>"
        f'<ShiftObjectId xsi:nil="true" />'
        f'<TimesheetApprovalManagerObjectId xsi:nil="true" />'
        f'<Title xsi:nil="true" />'
        f'<UnitOfMeasureObjectId xsi:nil="true" />'
        f"<UseTimesheets>0</UseTimesheets>"
        f'<UserObjectId xsi:nil="true" />'
        f"</Resource>"
    )


# A resource's *rate* is never carried on the <Resource> element itself —
# confirmed directly against the real reference file: <Resource> has no
# price field anywhere, and every resource's cost basis comes from a
# separate, top-level <ResourceRate> element instead (same split as XER's
# own RSRC/RSRCRATE tables). Missing this entirely (2026-07-15 fix, same bug
# report as _resource_xml's own header) is the most likely reason resources
# imported with no cost data even though each ResourceAssignment already
# carried its own PricePerUnit/PlannedCost directly.
def _resource_rate_xml(r, rate_id: int) -> str:  # noqa: ANN001 — p6_export.P6Resource
    return (
        f"<ResourceRate>"
        f"<EffectiveDate>2000-01-01T00:00:00</EffectiveDate>"
        f"<MaxUnitsPerTime>1</MaxUnitsPerTime>"
        f"<ObjectId>{rate_id}</ObjectId>"
        f"<PricePerUnit>{_fmt_dec(r.rate, 2)}</PricePerUnit>"
        f"<ResourceObjectId>{r.id}</ResourceObjectId>"
        f'<ShiftPeriodObjectId xsi:nil="true" />'
        f"</ResourceRate>"
    )


def _wbs_xml(w) -> str:  # noqa: ANN001 — p6_export.P6Wbs
    udf = ""  # WBS-level UDFs aren't gathered by p6_export.py this pass (activity UDFs only) — see its own header.
    return (
        f"<WBS>"
        f"{_el('Code', w.code)}"
        f"<GUID>{w.guid}</GUID>"
        f"{_el('Name', w.name)}"
        f"<ObjectId>{w.id}</ObjectId>"
        f"{f'<ParentObjectId>{w.parent_id}</ParentObjectId>' if w.parent_id is not None else '<ParentObjectId xsi:nil=\"true\" />'}"
        f"<ProjectObjectId>1</ProjectObjectId>"
        f"<SequenceNumber>{w.seq_num}</SequenceNumber>"
        f"<Status>Active</Status>"
        f"{f'<Description>{escape(w.commentary)}</Description>' if w.commentary else ''}"
        f"{udf}"
        f"</WBS>"
    )


_TASK_TYPE_NAMES = {"TT_Task": "Task Dependent", "TT_Mile": "Start Milestone", "TT_FinMile": "Finish Milestone"}
_STATUS_NAMES = {"TK_NotStart": "Not Started", "TK_Active": "In Progress", "TK_Complete": "Completed"}


def _activity_xml(a, udf_values_by_task: dict[int, list]) -> str:  # noqa: ANN001 — p6_export.P6Activity
    udf_xml = "".join(
        f"<UDF><TypeObjectId>{v.udf_type_id}</TypeObjectId>{_udf_value_element(v)}</UDF>"
        for v in udf_values_by_task.get(a.id, [])
    )
    return (
        f"<Activity>"
        f"{f'<ActualFinishDate>{_fmt_datetime(a.actual_finish)}</ActualFinishDate>' if a.actual_finish else '<ActualFinishDate xsi:nil=\"true\" />'}"
        f"{f'<ActualStartDate>{_fmt_datetime(a.actual_start)}</ActualStartDate>' if a.actual_start else '<ActualStartDate xsi:nil=\"true\" />'}"
        f"<CalendarObjectId>{a.calendar_id}</CalendarObjectId>"
        f"<DurationType>Fixed Duration and Units/Time</DurationType>"
        f"{f'<FinishDate>{_fmt_datetime(a.finish)}</FinishDate>' if a.finish else '<FinishDate xsi:nil=\"true\" />'}"
        f"<GUID>{a.guid}</GUID>"
        f"{_el('Id', a.code)}"
        f"{_el('Name', a.name)}"
        f"<ObjectId>{a.id}</ObjectId>"
        # P6's own convention is a 0-1 fraction, not Prosota's 0-100 scale
        # — see p6_import_parse.py's own header on _parse_activity's
        # matching /100 fix (2026-09-04, real-file-confirmed: 0.2/0.82/0.9
        # etc. alongside plain 0/1, never a bare "82").
        f"<PercentComplete>{_fmt_dec(a.pct_complete / 100, 4)}</PercentComplete>"
        f"<PercentCompleteType>Physical</PercentCompleteType>"
        f"<PlannedDuration>{_fmt_dec(a.duration_hours, 2)}</PlannedDuration>"
        f"{f'<PlannedFinishDate>{_fmt_datetime(a.finish)}</PlannedFinishDate>' if a.finish else '<PlannedFinishDate xsi:nil=\"true\" />'}"
        f"{f'<PlannedStartDate>{_fmt_datetime(a.start)}</PlannedStartDate>' if a.start else '<PlannedStartDate xsi:nil=\"true\" />'}"
        f"{f'<PrimaryConstraintDate>{_fmt_datetime(a.constraint_date)}</PrimaryConstraintDate>' if a.constraint_date else '<PrimaryConstraintDate xsi:nil=\"true\" />'}"
        f"{_el('PrimaryConstraintType', a.constraint_type) if a.constraint_type else '<PrimaryConstraintType xsi:nil=\"true\" />'}"
        f"<ProjectObjectId>1</ProjectObjectId>"
        f"{f'<RemainingFinishDate>{_fmt_datetime(a.finish)}</RemainingFinishDate>' if a.finish else '<RemainingFinishDate xsi:nil=\"true\" />'}"
        f"{f'<RemainingStartDate>{_fmt_datetime(a.start)}</RemainingStartDate>' if a.start else '<RemainingStartDate xsi:nil=\"true\" />'}"
        f"<Status>{_STATUS_NAMES.get(a.status_code, 'Not Started')}</Status>"
        f"{f'<StartDate>{_fmt_datetime(a.start)}</StartDate>' if a.start else '<StartDate xsi:nil=\"true\" />'}"
        f"<TotalFloat>{_fmt_dec(a.total_float_hours, 2) if a.total_float_hours is not None else ''}</TotalFloat>"
        f"<FreeFloat>{_fmt_dec(a.free_float_hours, 2) if a.free_float_hours is not None else ''}</FreeFloat>"
        f"<Type>{_TASK_TYPE_NAMES.get(a.task_type, 'Task Dependent')}</Type>"
        f"<WBSObjectId>{a.wbs_id}</WBSObjectId>"
        f"{f'<Notes>{escape(a.commentary)}</Notes>' if a.commentary else ''}"
        f"{udf_xml}"
        f"</Activity>"
    )


def _relationship_xml(rel) -> str:  # noqa: ANN001 — p6_export.P6Relationship
    return (
        f"<Relationship>"
        f"<Lag>{_fmt_dec(rel.lag_hours, 2)}</Lag>"
        f"<ObjectId>{rel.id}</ObjectId>"
        f"<PredecessorActivityObjectId>{rel.pred_id}</PredecessorActivityObjectId>"
        f"<PredecessorProjectObjectId>1</PredecessorProjectObjectId>"
        f"<SuccessorActivityObjectId>{rel.succ_id}</SuccessorActivityObjectId>"
        f"<SuccessorProjectObjectId>1</SuccessorProjectObjectId>"
        f"<Type>{_RELATIONSHIP_TYPE_NAMES.get(rel.type.replace('PR_', ''), 'Finish to Start')}</Type>"
        f"</Relationship>"
    )


# Full field set + real alphabetical order (same 2026-07-15 fix as
# _resource_xml above) — notably including WBSObjectId, which the trimmed
# version omitted entirely despite the real sample carrying it on every row;
# needs the owning activity (for its wbs_id/start/finish), not just the
# assignment's own fields, hence the extra activity_by_id lookup.
def _resource_assignment_xml(asg, activity_by_id: dict, resource_by_id: dict) -> str:  # noqa: ANN001 — p6_export.{P6Assignment,P6Activity,P6Resource} lookups
    activity = activity_by_id.get(asg.task_id)
    start = activity.start if activity is not None else None
    finish = activity.finish if activity is not None else None
    wbs_id = activity.wbs_id if activity is not None else None
    resource = resource_by_id.get(asg.rsrc_id)
    resource_type_name = _RESOURCE_TYPE_NAMES.get(resource.rsrc_type, "Labor") if resource is not None else "Labor"
    return (
        f"<ResourceAssignment>"
        f"<ActivityObjectId>{asg.task_id}</ActivityObjectId>"
        f"<ActualCost>0</ActualCost>"
        f'<ActualCurve xsi:nil="true" />'
        f'<ActualFinishDate xsi:nil="true" />'
        f"<ActualOvertimeCost>0</ActualOvertimeCost>"
        f"<ActualOvertimeUnits>0</ActualOvertimeUnits>"
        f"<ActualRegularCost>0</ActualRegularCost>"
        f"<ActualRegularUnits>0</ActualRegularUnits>"
        f'<ActualStartDate xsi:nil="true" />'
        f"<ActualThisPeriodCost>0</ActualThisPeriodCost>"
        f"<ActualThisPeriodUnits>0</ActualThisPeriodUnits>"
        f"<ActualUnits>0</ActualUnits>"
        f"<AtCompletionCost>{_fmt_dec(asg.cost, 2)}</AtCompletionCost>"
        f"<AtCompletionUnits>{_fmt_dec(asg.qty, 2)}</AtCompletionUnits>"
        f'<CostAccountObjectId xsi:nil="true" />'
        f"<DrivingActivityDatesFlag>0</DrivingActivityDatesFlag>"
        f"{f'<FinishDate>{_fmt_datetime(finish)}</FinishDate>' if finish else '<FinishDate xsi:nil=\"true\" />'}"
        f"<GUID>{_guid_braces()}</GUID>"
        f"<IsCostUnitsLinked>1</IsCostUnitsLinked>"
        f"<IsPrimaryResource>1</IsPrimaryResource>"
        f"<ObjectId>{asg.id}</ObjectId>"
        f"<OvertimeFactor>0</OvertimeFactor>"
        f"<PlannedCost>{_fmt_dec(asg.cost, 2)}</PlannedCost>"
        f'<PlannedCurve xsi:nil="true" />'
        f"{f'<PlannedFinishDate>{_fmt_datetime(finish)}</PlannedFinishDate>' if finish else '<PlannedFinishDate xsi:nil=\"true\" />'}"
        f"<PlannedLag>0</PlannedLag>"
        f"{f'<PlannedStartDate>{_fmt_datetime(start)}</PlannedStartDate>' if start else '<PlannedStartDate xsi:nil=\"true\" />'}"
        f"<PlannedUnits>{_fmt_dec(asg.qty, 2)}</PlannedUnits>"
        f"<PlannedUnitsPerTime>1</PlannedUnitsPerTime>"
        f"<PricePerUnit>{_fmt_dec(asg.cost_per_qty, 2)}</PricePerUnit>"
        f'<Proficiency xsi:nil="true" />'
        f"<ProjectObjectId>1</ProjectObjectId>"
        f"<RateSource>Resource</RateSource>"
        f"<RateType>Price / Unit</RateType>"
        f"<RemainingCost>{_fmt_dec(asg.cost, 2)}</RemainingCost>"
        f'<RemainingCurve xsi:nil="true" />'
        f"<RemainingDuration>{_fmt_dec(asg.qty, 2)}</RemainingDuration>"
        f"{f'<RemainingFinishDate>{_fmt_datetime(finish)}</RemainingFinishDate>' if finish else '<RemainingFinishDate xsi:nil=\"true\" />'}"
        f"<RemainingLag>0</RemainingLag>"
        f"{f'<RemainingStartDate>{_fmt_datetime(start)}</RemainingStartDate>' if start else '<RemainingStartDate xsi:nil=\"true\" />'}"
        f"<RemainingUnits>{_fmt_dec(asg.qty, 2)}</RemainingUnits>"
        f"<RemainingUnitsPerTime>1</RemainingUnitsPerTime>"
        f'<ResourceCurveObjectId xsi:nil="true" />'
        f"<ResourceObjectId>{asg.rsrc_id}</ResourceObjectId>"
        f"<ResourceType>{resource_type_name}</ResourceType>"
        f'<RoleObjectId xsi:nil="true" />'
        f"{f'<StartDate>{_fmt_datetime(start)}</StartDate>' if start else '<StartDate xsi:nil=\"true\" />'}"
        f"<UnitsPercentComplete>0</UnitsPercentComplete>"
        f"{f'<WBSObjectId>{wbs_id}</WBSObjectId>' if wbs_id is not None else '<WBSObjectId xsi:nil=\"true\" />'}"
        f"</ResourceAssignment>"
    )


def _udftype_xml(u) -> str:  # noqa: ANN001 — p6_export.P6UdfType
    subject_area = {"TASK": "Activity", "PROJWBS": "WBS", "RSRC": "Resource"}.get(u.table_name, "Activity")
    data_type_name = {
        "FT_FLOAT": "Double", "FT_INT": "Integer", "FT_MONEY": "Cost", "FT_DATE": "Date",
    }.get(u.data_type, "Text")
    return (
        f"<UDFType>"
        f"<DataType>{data_type_name}</DataType>"
        f"<ObjectId>{u.id}</ObjectId>"
        f"<SubjectArea>{subject_area}</SubjectArea>"
        f"{_el('Title', u.label)}"
        f"</UDFType>"
    )


def build_pmxml(data: P6ExportData) -> str:
    """Assembles one complete PMXML document. Structural nesting confirmed
    directly against the real reference file (not assumed): Calendar and
    Resource are top-level siblings of Project under <APIBusinessObjects>
    (P6 treats them as enterprise-level, shared-across-projects entities),
    while WBS/Activity/Relationship/ResourceAssignment are all nested
    *inside* <Project>...</Project> — confirmed via direct byte-offset
    comparison in the real file (every <WBS>/<Activity>/<Relationship>/
    <ResourceAssignment> occurrence falls between the single <Project> and
    </Project> tag; every <Calendar>/<Resource> occurrence falls outside
    it)."""
    udf_values_by_task: dict[int, list] = {}
    for v in data.udf_values:
        udf_values_by_task.setdefault(v.fk_id, []).append(v)
    activity_by_id = {a.id: a for a in data.activities}
    resource_by_id = {r.id: r for r in data.resources}

    parts = ['<?xml version="1.0" encoding="utf-8"?>']
    parts.append(
        f'<APIBusinessObjects xmlns="{_XMLNS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        f'xsi:schemaLocation="{_XMLNS} {_XMLNS.replace("BusinessObjects", "p6apibo.xsd")}">'
    )
    parts.append(
        "<Currency><DecimalPlaces>2</DecimalPlaces><DigitGroupingSymbol>Comma</DigitGroupingSymbol>"
        "<ExchangeRate>1</ExchangeRate><Id>GBP</Id><Name>Great British Pounds</Name>"
        '<ObjectId>1</ObjectId><PositiveSymbol>#1.1</PositiveSymbol><Symbol>£</Symbol></Currency>'
    )
    for u in data.udf_types:
        parts.append(_udftype_xml(u))
    for c in data.calendars:
        parts.append(_calendar_xml(c))
    for r in data.resources:
        parts.append(_resource_xml(r))
    # One ResourceRate per resource, keyed by its own new sequential id
    # range so it never collides with any other entity's ObjectId — see
    # _resource_rate_xml's own header on why this is a separate top-level
    # element at all, not a field on <Resource> itself.
    for r in data.resources:
        parts.append(_resource_rate_xml(r, 1_000_000 + r.id))

    parts.append("<Project>")
    parts.append(f"<DataDate>{_fmt_datetime(data.data_date)}</DataDate>")
    parts.append(f"<GUID>{data.project_guid}</GUID>")
    parts.append(_el("Id", data.project_name[:100]))
    parts.append(f"<ObjectId>{data.project_id}</ObjectId>")
    if data.plan_start is not None:
        parts.append(f"<PlannedStartDate>{_fmt_datetime(data.plan_start)}</PlannedStartDate>")
    default_calendar = next((c for c in data.calendars if c.is_default), None)
    if default_calendar is not None:
        parts.append(f"<ActivityDefaultCalendarObjectId>{default_calendar.id}</ActivityDefaultCalendarObjectId>")
    for w in data.wbs_nodes:
        parts.append(_wbs_xml(w))
    for a in data.activities:
        parts.append(_activity_xml(a, udf_values_by_task))
    for asg in data.assignments:
        parts.append(_resource_assignment_xml(asg, activity_by_id, resource_by_id))
    for rel in data.relationships:
        parts.append(_relationship_xml(rel))
    parts.append("</Project>")

    parts.append("</APIBusinessObjects>")
    return "\n".join(parts)
