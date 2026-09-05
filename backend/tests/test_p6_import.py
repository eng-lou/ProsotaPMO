from __future__ import annotations

import pathlib
import uuid
from datetime import date, datetime, time
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.activity import Activity
from app.models.calendar import Calendar, CalendarBreak
from app.models.cost_element import CostElement
from app.models.organisation import Organisation
from app.models.project import Project
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.schedule_baseline import ScheduleBaseline, ScheduleBaselineActivity
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_variant import ScheduleVariant
from app.models.user import User
from app.models.user_defined_field import UserDefinedFieldDefinition, UserDefinedFieldValue
from app.services import schedule_variant as schedule_variant_svc
from app.services.activity import _attach_evm_fields
from app.services.activity import list_activities as _list_activities_with_evm
from app.services.p6_import import import_pmxml
from app.services.p6_import_parse import parse_pmxml
from app.services.resource_costing import compute_assignment_budget
from tests.test_p6_export import _seed_schedule

# Real, un-modified P6 reference files Maro supplied outside the repo (see
# app/services/p6_import_parse.py's own header) — used to prove the parser
# handles genuine external P6 output, not just Prosota's own round-tripped
# dialect. Skipped, not failed, when the environment doesn't have them (CI,
# a fresh clone) rather than pretending this coverage exists everywhere.
_FIXTURE_DIR = pathlib.Path(r"C:\Users\Maro\Documents\ProsotaPMO\source\schedule")

# 2026-09-03 — every import in this file now round-trips through real R2
# object storage (see app/api/p6_import.py's own header for why: a real
# PMXML export routinely exceeds Vercel's 4.5MB request-body cap, so this
# had to move off multipart onto the same presign/PUT/download pattern
# ai_attachments.py/model3d_files.py/site_capture.py already use). None of
# those other presign-based features have R2-touching tests either — R2
# credentials were never configured for local dev (confirmed: r2_account_id
# is blank in backend/.env), only in the real deployed environment. Skipped,
# not failed, same "environment doesn't have it" discipline as the external
# fixture files above, rather than pretending this coverage exists locally.
_R2_CONFIGURED = bool(settings.r2_account_id)


@pytest_asyncio.fixture
async def target_project(db: AsyncSession, org: Organisation, user: User) -> Project:
    """A second, unrelated project in the same org — the round-trip test
    imports into this rather than back into the project it was exported
    from, so every resource/calendar takes the "create new" path instead of
    being matched-and-reused by name (that path is covered separately by
    test_duplicate_import_reuses_resources_and_calendars below)."""
    p = Project(org_id=org.id, created_by=user.id, name="Import Target Project", client_name="Test Client")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


async def _export_xml(client: AsyncClient, period: SchedulePeriod) -> bytes:
    resp = await client.get("/api/v1/p6-export/xml", params={"schedule_period_id": str(period.id)})
    assert resp.status_code == 200, resp.text
    return resp.content


async def _import_xml(client: AsyncClient, project: Project, data: bytes, filename: str = "schedule.xml") -> dict:
    if not _R2_CONFIGURED:
        pytest.skip("R2 credentials not configured in this environment")
    # Direct-to-R2 (2026-09-03) — uploads real bytes to the real object store
    # first (same call the presigned PUT url would eventually reach), then
    # calls /xml with the resulting storage_key, exercising the real
    # download-from-R2 + parse + import + cleanup path end to end, not just
    # a mocked request body. See app/api/p6_import.py's own header for why
    # this replaced the old multipart-upload shape.
    from app.services import object_storage
    storage_key = object_storage.generate_storage_key("p6-imports", filename)
    object_storage.upload_bytes(storage_key, data, "application/xml")
    resp = await client.post(
        "/api/v1/p6-import/xml",
        json={"project_id": str(project.id), "storage_key": storage_key},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_round_trip_export_then_import(
    client: AsyncClient, db: AsyncSession, project: Project, target_project: Project,
    live_schedule_period: SchedulePeriod,
):
    await _seed_schedule(client, project, live_schedule_period)
    xml_bytes = await _export_xml(client, live_schedule_period)

    summary = await _import_xml(client, target_project, xml_bytes)

    # p6_export.py always writes one synthetic project-root WBS node named
    # after the source project ("Test Project", the `project` fixture's own
    # name) above whatever WBS the schedule itself has. On the way back in,
    # p6_import.py now *also* synthesizes its own project-root Activity (a P
    # role, from the real <Project> — 2026-09-03, per Maro: a real P6 file's
    # top-level WBS branches were wrongly landing as their own separate P
    # rows instead of nesting under one true project root) — so the exported
    # "Test Project" WBS node lands one level down, demoted to a W under
    # that new P. Round trip is that new P root + the old "Test Project" W +
    # "Structure" + 2 tasks = 5, not 4.
    assert summary["activity_count"] == 5
    assert summary["relationship_count"] == 1
    assert summary["resource_count"] == 1
    assert summary["assignment_count"] == 1
    assert summary["calendar_count"] == 1
    # 1 real custom UDF value + 1 "P6 Activity ID" UDF value per real
    # <Activity> element (2, the two tasks — WBS/summary rows have no P6
    # Activity Id of their own to capture).
    assert summary["udf_value_count"] == 3
    assert summary["skipped"] == []

    variant_id = uuid.UUID(summary["schedule_variant_id"])
    variant = await db.get(ScheduleVariant, variant_id)
    assert variant is not None
    assert variant.project_id == target_project.id
    assert variant.is_master is False

    activities = (await db.execute(
        select(Activity).where(Activity.schedule_variant_id == variant_id)
    )).scalars().all()
    assert len(activities) == 5

    root = next(a for a in activities if a.parent_id is None)
    assert root.task_name == "Test Project"
    assert root.wbs_role == "P"

    export_root_wbs = next(a for a in activities if a.parent_id == root.id)
    assert export_root_wbs.task_name == "Test Project"
    assert export_root_wbs.wbs_role == "W"

    structure = next(a for a in activities if a.parent_id == export_root_wbs.id)
    assert structure.task_name == "Structure"
    assert structure.activity_type == "wbs_summary"

    task_a = next(a for a in activities if a.task_name == "Excavate & Prep")
    assert task_a.commentary == "Watch out for the buried services."
    assert task_a.duration_hours == Decimal("32.00")
    assert task_a.parent_id == structure.id

    # Freshly created in target_project (no pre-existing resource of this
    # name) — the day/hour rate conversion round-trips exactly: exported as
    # £56.25/hour (450/day at 8h/day), re-imported at the same 8h/day
    # calendar should land back on £450/day.
    resource = (await db.execute(
        select(Resource).where(Resource.project_id == target_project.id)
    )).scalar_one()
    assert resource.name == "J. Davies"
    assert resource.rate == Decimal("450.00")
    assert resource.unit == "day"

    calendar = (await db.execute(
        select(Calendar).where(Calendar.project_id == target_project.id)
    )).scalar_one()
    assert calendar.name == "Trades Calendar"
    assert calendar.works_monday is True
    assert calendar.works_saturday is False

    breaks = (await db.execute(
        select(CalendarBreak).where(CalendarBreak.calendar_id == calendar.id)
    )).scalars().all()
    assert len(breaks) == 1


async def test_duplicate_import_reuses_resources_and_calendars(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod,
):
    """Importing the same file twice into the *same* project must not
    duplicate resources/calendars (matched by name, per Maro's own
    confirmation while planning this feature) — but each import is still
    its own independently reviewable Schedule Variant, never merged."""
    await _seed_schedule(client, project, live_schedule_period)
    xml_bytes = await _export_xml(client, live_schedule_period)

    first = await _import_xml(client, project, xml_bytes)
    second = await _import_xml(client, project, xml_bytes)

    assert first["schedule_variant_id"] != second["schedule_variant_id"]

    variants = (await db.execute(
        select(ScheduleVariant).where(ScheduleVariant.project_id == project.id)
    )).scalars().all()
    # the master (from live_schedule_period's own fixture chain) + 2 imports
    assert len(variants) == 3

    resources = (await db.execute(
        select(Resource).where(Resource.project_id == project.id)
    )).scalars().all()
    assert len(resources) == 1

    calendars = (await db.execute(
        select(Calendar).where(Calendar.project_id == project.id)
    )).scalars().all()
    assert len(calendars) == 1


async def test_import_real_external_file(client: AsyncClient, project: Project):
    """A genuine external P6 export Prosota never touched — proves the
    parser handles real-world P6 output (unsupported activity types, WBS
    nesting, resource rates, UDFs) rather than just its own round-tripped
    dialect."""
    xml_path = _FIXTURE_DIR / "EC00610 - B1.xml"
    if not xml_path.exists():
        pytest.skip("real P6 reference file not available in this environment")

    summary = await _import_xml(client, project, xml_path.read_bytes(), filename="EC00610 - B1.xml")

    assert summary["activity_count"] > 0
    assert summary["relationship_count"] > 0
    assert summary["resource_count"] > 0
    assert summary["calendar_count"] > 0


async def test_import_zeroes_out_milestone_duration(client: AsyncClient, project: Project):
    """A real bug found importing EC00610 - B1.xml (2026-07-16, per Maro:
    "the EC1 project failed to load schedule") — P6 routinely writes a
    nonzero <PlannedDuration> on a Start/Finish Milestone activity even
    though P6 itself treats it as an instant, but Prosota's own
    ActivityBase.milestones_have_zero_duration validator rejects that,
    which 500'd the *response* the moment the Activities grid tried to load
    the imported schedule (not the import itself, which has no such check
    — the row saved fine, only reading it back broke)."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Project><Id>Milestone Test</Id>"
        b'<WBS><ObjectId>1</ObjectId><Name>Root</Name></WBS>'
        b'<Activity><ObjectId>2</ObjectId><WBSObjectId>1</WBSObjectId><Id>A1</Id>'
        b"<Name>Site Handover</Name><Type>Start Milestone</Type>"
        b"<PlannedDuration>8</PlannedDuration><PercentComplete>0</PercentComplete></Activity>"
        b"</Project></APIBusinessObjects>"
    )
    summary = await _import_xml(client, project, xml, filename="milestone.xml")
    assert summary["skipped"] == []

    resp = await client.get(
        "/api/v1/activities/",
        params={"project_id": str(project.id), "schedule_period_id": summary["schedule_period_id"]},
    )
    assert resp.status_code == 200, resp.text
    milestone = next(a for a in resp.json() if a["task_name"] == "Site Handover")
    assert milestone["duration_hours"] in (None, "0", "0.00")


async def test_import_root_dates_udf_and_baseline(db: AsyncSession, project: Project):
    """Calls parse_pmxml/import_pmxml directly (no R2 round trip needed —
    unlike every other test in this file, this exercises pure parsing plus
    real DB writes) against a hand-built two-WBS-branch, one-baseline file
    shaped like the real external export (EC00630.xml) that surfaced these
    four gaps (2026-09-03, per Maro):
    1. dates anchored to "now" instead of the file's own DataDate
    2. no UDF captured P6's own Activity Id (Prosota generates its own code)
    3. baselines in the file were never imported at all
    4. every top-level WBS branch became its own separate P row instead of
       nesting under one true project-root P

    Verified directly against the real EC00630.xml too (132/132 baseline
    activities matched by P6 Activity Id in both of its two baselines, real
    project Name/DataDate correctly parsed) via a one-off script calling
    parse_pmxml on the actual file — not committed as a test since the file
    lives outside the repo, but confirms this synthetic fixture isn't
    testing a shape parse_pmxml wouldn't actually see in practice."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects" '
        b'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        b"<Project><ObjectId>1</ObjectId><Id>Multi Test</Id><Name>Multi Branch Project</Name>"
        b"<DataDate>2015-03-10T00:00:00</DataDate>"
        b'<WBS><ObjectId>10</ObjectId><Name>Block A</Name><ProjectObjectId>1</ProjectObjectId>'
        b'<ParentObjectId xsi:nil="true" /></WBS>'
        b'<WBS><ObjectId>20</ObjectId><Name>Block B</Name><ProjectObjectId>1</ProjectObjectId>'
        b'<ParentObjectId xsi:nil="true" /></WBS>'
        b"<Activity><ObjectId>100</ObjectId><Id>A100</Id><Name>Pour Slab</Name><Type>Task Dependent</Type>"
        b"<WBSObjectId>10</WBSObjectId><ProjectObjectId>1</ProjectObjectId>"
        b"<PlannedDuration>8</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<StartDate>2015-03-10T08:00:00</StartDate><FinishDate>2015-03-11T08:00:00</FinishDate></Activity>"
        b"<Activity><ObjectId>200</ObjectId><Id>A200</Id><Name>Erect Frame</Name><Type>Task Dependent</Type>"
        b"<WBSObjectId>20</WBSObjectId><ProjectObjectId>1</ProjectObjectId>"
        b"<PlannedDuration>16</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<StartDate>2015-03-12T08:00:00</StartDate><FinishDate>2015-03-14T08:00:00</FinishDate></Activity>"
        b"</Project>"
        b"<BaselineProject><ObjectId>2</ObjectId><OriginalProjectObjectId>1</OriginalProjectObjectId>"
        b"<BaselineTypeName>Approved Baseline</BaselineTypeName><DataDate>2015-03-01T00:00:00</DataDate>"
        b"<Activity><ObjectId>900</ObjectId><Id>A100</Id><Name>Pour Slab</Name>"
        b"<PlannedDuration>8</PlannedDuration>"
        b"<StartDate>2015-03-05T08:00:00</StartDate><FinishDate>2015-03-06T08:00:00</FinishDate></Activity>"
        b"<Activity><ObjectId>901</ObjectId><Id>A200</Id><Name>Erect Frame</Name>"
        b"<PlannedDuration>16</PlannedDuration>"
        b"<StartDate>2015-03-07T08:00:00</StartDate><FinishDate>2015-03-09T08:00:00</FinishDate></Activity>"
        b"</BaselineProject>"
        b"</APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    summary = await import_pmxml(db, project.id, parsed)
    assert summary.baseline_count == 1

    activities = (await db.execute(
        select(Activity).where(Activity.schedule_period_id == summary.schedule_period_id)
    )).scalars().all()

    root = next(a for a in activities if a.parent_id is None)
    assert root.task_name == "Multi Branch Project"
    assert root.wbs_role == "P"

    block_a = next(a for a in activities if a.task_name == "Block A")
    block_b = next(a for a in activities if a.task_name == "Block B")
    assert block_a.parent_id == root.id and block_a.wbs_role == "W"
    assert block_b.parent_id == root.id and block_b.wbs_role == "W"

    period = await db.get(SchedulePeriod, summary.schedule_period_id)
    assert period.start_date == date(2015, 3, 10)

    udf_def = (await db.execute(
        select(UserDefinedFieldDefinition).where(
            UserDefinedFieldDefinition.project_id == project.id,
            UserDefinedFieldDefinition.name == "P6 Activity ID",
        )
    )).scalar_one()
    slab = next(a for a in activities if a.task_name == "Pour Slab")
    udf_value = (await db.execute(
        select(UserDefinedFieldValue).where(
            UserDefinedFieldValue.field_definition_id == udf_def.id,
            UserDefinedFieldValue.record_id == slab.id,
        )
    )).scalar_one()
    assert udf_value.value_text == "A100"

    baseline = (await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.schedule_period_id == summary.schedule_period_id)
    )).scalar_one()
    assert baseline.name == "Approved Baseline"
    assert baseline.baseline_date == date(2015, 3, 1)

    snap = (await db.execute(
        select(ScheduleBaselineActivity).where(
            ScheduleBaselineActivity.baseline_id == baseline.id,
            ScheduleBaselineActivity.activity_id == slab.id,
        )
    )).scalar_one()
    assert snap.start == datetime(2015, 3, 5, 8, 0, 0)
    assert snap.duration_hours == Decimal("8")


async def test_progressed_activity_keeps_real_historical_position_not_rescheduled(db: AsyncSession, project: Project):
    """A real bug found on a real historical import (2026-09-04, per Maro:
    PV showed £0 across the board on the PV/EV/AC Trend chart, even for
    activities completed years before the file's own DataDate, then "if
    that's the figure for May, clearly october had to be higher... you need
    to check properly again"). scheduling_cpm.recompute_schedule's own "an
    already-progressed activity's Start is a recorded fact" preservation
    branch (has_progress and a.start is not None) only fires when .start is
    already set to *something* before that first recompute runs —
    import_pmxml never set it, so every activity, even ones already 100%
    complete years before the data date, got rescheduled as if starting
    fresh from it, and PV's own elapsed-fraction formula always saw
    "hasn't started yet".

    Also covers the sibling bug found alongside it: a real P6
    <PercentComplete> is a 0-1 fraction (confirmed against the real file:
    0.2/0.82/0.9/0.92 alongside plain 0/1), not Prosota's own 0-100 scale."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Project><Id>Progress Position Test</Id><DataDate>2011-05-01T00:00:00</DataDate>"
        b"<Activity><ObjectId>1</ObjectId><Id>A1</Id><Name>Groundworks</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>800</PlannedDuration><PercentComplete>0.82</PercentComplete>"
        b"<StartDate>2010-01-04T08:00:00</StartDate><FinishDate>2010-06-01T17:00:00</FinishDate>"
        b"<ActualStartDate>2010-01-04T08:00:00</ActualStartDate><ActualFinishDate>2010-06-01T17:00:00</ActualFinishDate>"
        b"</Activity></Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    summary = await import_pmxml(db, project.id, parsed)

    activities = (await db.execute(
        select(Activity).where(Activity.schedule_period_id == summary.schedule_period_id)
    )).scalars().all()
    groundworks = next(a for a in activities if a.task_name == "Groundworks")
    assert groundworks.pct_complete == Decimal("82.00")
    # Real historical position preserved — NOT rescheduled forward to on/after
    # the file's own 2011-05-01 DataDate.
    assert groundworks.start == datetime(2010, 1, 4, 8, 0)
    assert groundworks.finish == datetime(2010, 6, 1, 17, 0)


def test_calendar_worktime_finish_is_inclusive_last_minute():
    """A real P6 export's every single WorkTime <Finish> ends in ":59"
    (11:59/15:59/16:59), never a clean hour boundary, while every <Start>
    sits exactly on the hour — and every one of its 3 calendars declares
    <HoursPerDay>8</HoursPerDay> but their literal Start-to-Finish windows
    only net 7h58m if Finish is read as an exclusive boundary. Reading
    Finish as inclusive of that minute (08:00-11:59 + 13:00-16:59 becomes
    08:00-12:00 + 13:00-17:00 = 8h exactly) is what actually matches the
    calendar's own declared day length (2026-09-04, per Maro: "fix that
    rounding gap" — this was silently understating every resource's
    day-rate conversion and every duration-to-days calculation by the same
    ~2 minutes/day)."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Calendar><ObjectId>1</ObjectId><Name>Trades</Name><HoursPerDay>8</HoursPerDay>"
        b"<StandardWorkWeek>"
        b"<StandardWorkHours><DayOfWeek>Monday</DayOfWeek>"
        b"<WorkTime><Start>08:00:00</Start><Finish>11:59:00</Finish></WorkTime>"
        b"<WorkTime><Start>13:00:00</Start><Finish>16:59:00</Finish></WorkTime>"
        b"</StandardWorkHours>"
        b"</StandardWorkWeek></Calendar>"
        b"<Project><Id>Calendar Test</Id></Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    cal = parsed.calendars[0]
    assert cal.day_start == time(8, 0)
    assert cal.day_end == time(17, 0)
    assert cal.breaks == [(time(12, 0), time(13, 0))]


async def test_status_derived_and_in_progress_finish_trusts_the_file(db: AsyncSession, project: Project):
    """Two real bugs found on a real, plain (no Excel-layering) UI import
    (2026-09-04, per Maro: "activities that are completed in P6 are showing
    as still planned in prosota" + "some dates are not accurate see overal
    finish"):

    1. pct_complete/actual_start/actual_finish were already carried through
       at import, but nothing ever derived Activity.status from them — every
       imported row sat at the model's own "planned" default regardless of
       what the file said.
    2. An activity still genuinely in progress (real % complete, no
       ActualFinishDate) had its own reported <FinishDate> discarded —
       scheduling_cpm.recompute_schedule's preservation branch keeps a
       progressed activity's .start but still recomputes .finish from
       duration+calendar, which has no way to reproduce whatever P6's own
       internal engine used to land on its real number (same class of gap
       apply_progress_snapshot's own trusted-finish fix already covers for
       the Excel-extract case — this is the same fix for a plain PMXML
       import with no Excel layering at all).

    Also covers a not-yet-reached milestone (0% complete, no duration or
    predecessors of its own — nothing for CPM to derive its position from
    at all) getting the same trusted-finish treatment, and a genuinely
    not-yet-started, unconstrained task getting the OPPOSITE treatment —
    trusting Prosota's own fresh CPM computation over a frozen file value
    (see test_pinned_predecessor_finish_propagates_to_its_own_successor
    and scheduling_cpm.recompute_schedule's own docstring for why)."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Project><Id>Status Test</Id><DataDate>2011-06-01T00:00:00</DataDate>"
        b"<Activity><ObjectId>1</ObjectId><Id>A1</Id><Name>Foundation Done</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>40</PlannedDuration><PercentComplete>1</PercentComplete>"
        b"<StartDate>2011-01-01T08:00:00</StartDate><FinishDate>2011-01-10T17:00:00</FinishDate>"
        b"<ActualStartDate>2011-01-01T08:00:00</ActualStartDate><ActualFinishDate>2011-01-10T17:00:00</ActualFinishDate>"
        b"</Activity>"
        b"<Activity><ObjectId>2</ObjectId><Id>A2</Id><Name>Groundworks 2</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>80</PlannedDuration><PercentComplete>0.5</PercentComplete>"
        b"<StartDate>2011-06-01T08:00:00</StartDate><FinishDate>2011-09-01T08:00:00</FinishDate>"
        b"<ActualStartDate>2011-06-01T08:00:00</ActualStartDate>"
        b"</Activity>"
        b"<Activity><ObjectId>3</ObjectId><Id>A3</Id><Name>Not Started Yet</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>40</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<StartDate>2097-03-01T10:40:00</StartDate><FinishDate>2097-03-06T10:40:00</FinishDate>"
        b"</Activity>"
        b"<Activity><ObjectId>4</ObjectId><Id>A4</Id><Name>Overall Finish</Name><Type>Finish Milestone</Type>"
        b"<PlannedDuration>0</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<FinishDate>2011-08-15T10:40:00</FinishDate>"
        b"</Activity>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    summary = await import_pmxml(db, project.id, parsed)

    activities = (await db.execute(
        select(Activity).where(Activity.schedule_period_id == summary.schedule_period_id)
    )).scalars().all()

    completed = next(a for a in activities if a.task_name == "Foundation Done")
    assert completed.status == "completed"

    in_progress = next(a for a in activities if a.task_name == "Groundworks 2")
    assert in_progress.status == "in_progress"
    # 2011-09-01 is deliberately later than Prosota's own finish_from_start
    # would compute from an 80h/8h-day calendar starting 2011-06-01 (~10
    # working days, mid-June) — proves this is genuinely pinned from the
    # file, not coincidentally matching whatever CPM would have computed.
    assert in_progress.finish == datetime(2011, 9, 1, 8, 0)

    not_started = next(a for a in activities if a.task_name == "Not Started Yet")
    assert not_started.status == "planned"
    # 2026-09-05, per Maro, correcting the *previous* version of this
    # assertion — a follow-up real comparison ("Pergola and Amenities", 0%
    # complete, no progress at all) found Prosota's own calendar math
    # already landing bit-for-bit on P6's actual value while the file's own
    # snapshot was stale by an hour. For genuinely not-yet-started,
    # unconstrained work, CPM's own fresh computation is the right answer,
    # not a frozen file value — the absurd 2097 dates are deliberate proof
    # that Prosota did NOT blindly copy them: with no predecessors, CPM
    # schedules this at the project's own data date instead.
    assert not_started.start != datetime(2097, 3, 1, 10, 40)
    assert not_started.start.year == 2011

    milestone = next(a for a in activities if a.task_name == "Overall Finish")
    assert milestone.status == "planned"
    assert milestone.finish == datetime(2011, 8, 15, 10, 40)


async def test_schedule_pct_complete_uses_actual_over_at_completion_not_duration_pct(
    db: AsyncSession, project: Project,
):
    """Real PV/Remaining-Duration mismatch (2026-09-05, per Maro: "Fab &
    Delivery" — Prosota showed Schedule % Complete 92.8% and Remaining
    Duration 16.2 days; P6's own report showed 92.35% and 6 days). Traced to
    two separate bugs sharing one root cause — Prosota's own
    remaining_duration_hours/schedule-%-driving-PV both used naive,
    Physical-%-based formulas instead of P6's own real, resource-loaded
    figures already sitting in the file:

    1. <DurationPercentComplete> (92.85% here) was being used as PV's own
       override, but it's genuinely a DIFFERENT ratio from what P6 itself
       reports as "Schedule % Complete" (92.35%) — the real one is
       ActualDuration / AtCompletionDuration (624 / 675.4667h = 92.38%,
       matching P6 far more closely).
    2. remaining_duration_hours was duration_hours x (1 - pct_complete/100)
       — P6's own <RemainingDuration> (51.4667h ≈ 6.4d, matching P6's "6")
       is a real, independently-tracked figure, not a naive Physical-%
       recompute."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Project><Id>Schedule Pct Test</Id><DataDate>2011-05-01T00:00:00</DataDate>"
        b"<Activity><ObjectId>1</ObjectId><Id>A1</Id><Name>Fab &amp; Delivery</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>720</PlannedDuration><PercentComplete>0.82</PercentComplete>"
        b"<ActualDuration>624</ActualDuration><AtCompletionDuration>675.466666666666</AtCompletionDuration>"
        b"<RemainingDuration>51.4666666666667</RemainingDuration>"
        b"<DurationPercentComplete>0.928518518518519</DurationPercentComplete>"
        b"<StartDate>2011-01-12T08:00:00</StartDate><FinishDate>2011-05-10T11:28:00</FinishDate>"
        b"<ActualStartDate>2011-01-12T08:00:00</ActualStartDate>"
        b"</Activity>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    await import_pmxml(db, project.id, parsed)

    activity = (await db.execute(
        select(Activity).where(Activity.project_id == project.id, Activity.task_name == "Fab & Delivery")
    )).scalar_one()

    # Duration % Complete stays exactly what the file said — its own real,
    # distinct P6 concept, unaffected by this fix.
    assert activity.duration_pct_complete == Decimal("92.85185185")
    # The NEW field that actually drives PV — a different, correct ratio.
    assert abs(activity.schedule_pct_complete_override - Decimal("92.38")) < Decimal("0.01")
    # Remaining Duration now trusted from the file directly (≈6.43 days),
    # not the old naive 720h x (1 - 82%) = 129.6h ≈ 16.2 days.
    assert abs(activity.remaining_duration_hours - Decimal("51.47")) < Decimal("0.01")


async def test_not_started_activity_gets_no_schedule_pct_override(db: AsyncSession, project: Project):
    """Real ~£4,745 PV shortfall on a real 132-activity project total
    (2026-09-06, per Maro: "so if schedule % complete is wrong, PV will
    also be wrong"). A not-yet-started activity always has
    ActualDuration=0, which the *previous* version of this override forced
    into schedule_pct_complete_override=0% unconditionally — but PV is a
    planned-schedule figure (Rita Mulcahy Ch.9: "the value of work PLANNED
    to be done"), not an actual-progress one. An activity that's overdue
    against its own original plan but hasn't started yet still has real
    Planned Value; only its Earned Value is genuinely 0. The override must
    stay None for a not-started activity so PV falls through to
    elapsed_duration_fraction's own calendar proration against the
    *planned* start/finish instead of being wrongly zeroed."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Project><Id>Not Started Override Test</Id><DataDate>2011-05-01T00:00:00</DataDate>"
        b"<Activity><ObjectId>1</ObjectId><Id>A1</Id><Name>Overdue Not Started</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>80</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<ActualDuration>0</ActualDuration><AtCompletionDuration>80</AtCompletionDuration>"
        b"<StartDate>2011-04-01T08:00:00</StartDate><FinishDate>2011-04-11T17:00:00</FinishDate>"
        b"</Activity>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    await import_pmxml(db, project.id, parsed)

    activity = (await db.execute(
        select(Activity).where(Activity.project_id == project.id, Activity.task_name == "Overdue Not Started")
    )).scalar_one()
    assert activity.schedule_pct_complete_override is None


async def test_wbs_summary_schedule_pct_complete_derived_from_pv_over_bac(db: AsyncSession, project: Project):
    """Real "15.6% vs P6's 12.8%" project-rollup mismatch (2026-09-06, per
    Maro: "think bout it, schedule % complete times the BAC of that
    activity gives you the PV.....so ofcourse its all related"). A WBS
    summary's own start/finish span its *entire* subtree — running
    elapsed_duration_fraction against that whole span (what
    _attach_evm_fields does for every activity, since it can't tell a row
    is a rollup) answers "how far through the whole project's date range
    are we," a different, coarser question than "how much of the summed
    budget should be earned by now." schedule_pct_complete = PV/BAC is the
    same identity every leaf's own PV is already defined by — the rollup
    must use it too, not an unrelated calendar-span calculation."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Resource><ObjectId>50</ObjectId><Name>Framer</Name><ResourceType>Labor</ResourceType></Resource>"
        b"<ResourceRate><ResourceObjectId>50</ResourceObjectId><PricePerUnit>10</PricePerUnit></ResourceRate>"
        b"<Project><ObjectId>1</ObjectId><Id>WBS Rollup Pct Test</Id><DataDate>2011-05-01T00:00:00</DataDate>"
        b"<WBS><ObjectId>900</ObjectId><Name>Phase 1</Name><Code>P1</Code></WBS>"
        # A long-running, mostly-future activity that would dominate a naive
        # calendar-span calc but should barely register in a PV/BAC one.
        b"<Activity><ObjectId>100</ObjectId><WBSObjectId>900</WBSObjectId><Id>A1</Id><Name>Long Future Task</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>8000</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<StartDate>2011-01-01T08:00:00</StartDate><FinishDate>2014-01-01T17:00:00</FinishDate></Activity>"
        b"<ResourceAssignment><ActivityObjectId>100</ActivityObjectId><ResourceObjectId>50</ResourceObjectId>"
        b"<PlannedUnits>8000</PlannedUnits></ResourceAssignment>"
        # A small, fully-earned activity — nearly all of the real BAC/PV/EV.
        b"<Activity><ObjectId>101</ObjectId><WBSObjectId>900</WBSObjectId><Id>A2</Id><Name>Small Done Task</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>80</PlannedDuration><PercentComplete>1</PercentComplete>"
        b"<ActualDuration>80</ActualDuration><AtCompletionDuration>80</AtCompletionDuration>"
        b"<StartDate>2011-01-01T08:00:00</StartDate><FinishDate>2011-01-11T17:00:00</FinishDate>"
        b"<ActualStartDate>2011-01-01T08:00:00</ActualStartDate><ActualFinishDate>2011-01-11T17:00:00</ActualFinishDate></Activity>"
        b"<ResourceAssignment><ActivityObjectId>101</ActivityObjectId><ResourceObjectId>50</ResourceObjectId>"
        b"<PlannedUnits>80</PlannedUnits></ResourceAssignment>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    summary = await import_pmxml(db, project.id, parsed)
    await schedule_variant_svc.promote_variant(db, summary.schedule_variant_id)

    activities = await _list_activities_with_evm(db, project.id, summary.schedule_period_id)
    wbs = next(a for a in activities if a.task_name == "Phase 1")
    assert wbs.bac is not None and wbs.pv is not None
    expected = (wbs.pv / wbs.bac * Decimal(100)).quantize(Decimal("0.01"))
    assert wbs.schedule_pct_complete == expected


async def test_pinned_predecessor_finish_propagates_to_its_own_successor(db: AsyncSession, project: Project):
    """The real cascade bug this whole pinning mechanism exists to fix
    (2026-09-05, per Maro, tracing an exact P6-vs-Prosota mismatch by hand):
    "Third Floor Masonry Structure" was In Progress (Physical % 90%, but
    Duration % only 77.78% — P6 had already re-projected its at-completion
    duration longer than planned once real progress showed it running
    behind pace, something Prosota's own duration-based finish_from_start
    has no way to reproduce). Its file-trusted finish gets pinned, but the
    OLD code applied that pin in a separate pass *after* the full CPM
    solve — so "Fourth Floor Slab", a plain FS+0 successor with no progress
    of its own, had already computed its own start from the predecessor's
    un-pinned (2 real working days too early) finish, and genuinely started
    before its own predecessor's real finish. Pinning inside the same
    recompute_schedule call fixes this: the successor is computed AFTER the
    predecessor in topological order, so it sees the pinned value."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Project><Id>Cascade Test</Id><DataDate>2011-01-01T00:00:00</DataDate>"
        b"<Activity><ObjectId>10</ObjectId><Id>P1</Id><Name>Third Floor Masonry Structure</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>80</PlannedDuration><PercentComplete>0.9</PercentComplete>"
        b"<StartDate>2011-01-03T08:00:00</StartDate><FinishDate>2011-01-20T08:00:00</FinishDate>"
        b"<ActualStartDate>2011-01-03T08:00:00</ActualStartDate>"
        b"</Activity>"
        b"<Activity><ObjectId>11</ObjectId><Id>S1</Id><Name>Fourth Floor Slab</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>40</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"</Activity>"
        b"<Relationship><PredecessorActivityObjectId>10</PredecessorActivityObjectId>"
        b"<SuccessorActivityObjectId>11</SuccessorActivityObjectId><Type>Finish to Start</Type></Relationship>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    summary = await import_pmxml(db, project.id, parsed)

    activities = (await db.execute(
        select(Activity).where(Activity.schedule_period_id == summary.schedule_period_id)
    )).scalars().all()
    predecessor = next(a for a in activities if a.task_name == "Third Floor Masonry Structure")
    successor = next(a for a in activities if a.task_name == "Fourth Floor Slab")

    # Pinned from the file, not Prosota's own (2 working days earlier) calendar math.
    assert predecessor.finish == datetime(2011, 1, 20, 8, 0)
    # The successor must never start before its own predecessor finishes on
    # a plain FS+0 link — this is the exact real-world violation Maro found.
    assert successor.start >= predecessor.finish
    assert successor.start == datetime(2011, 1, 20, 8, 0)


async def test_completed_start_milestone_with_zero_percent_complete_is_not_rescheduled(
    db: AsyncSession, project: Project,
):
    """A real, fourth bug found the same day, on a real live import (Maro:
    "you've not even properly actualised certain activities" — a real P6
    "Building Pad Delivered by Owner" Start Milestone, genuinely delivered
    in September 2010, showing as Status "Planned" with Start rescheduled
    all the way forward to the file's own 2011 DataDate).

    Confirmed against the real file: a P6 Start Milestone that has actually
    occurred reports PercentComplete=0 regardless — P6 signals its
    completion purely via ActualStartDate/ActualFinishDate being set, not
    via PercentComplete the way a Task Dependent activity would.
    _derive_activity_status's own milestone branch only ever checked
    pct >= 100, so this milestone's status landed "planned" at import; that
    wrong status meant recompute_schedule's own "already progressed, keep
    its real Start" preservation branch (which also only checked
    pct_complete > 0) never fired for it either, so it got rescheduled
    forward as if it hadn't happened at all — discarding a delivery date
    from over half a year before the data date."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Project><Id>Milestone Actualised Test</Id><DataDate>2011-05-01T00:00:00</DataDate>"
        b"<Activity><ObjectId>1</ObjectId><Id>A1</Id><Name>Building Pad Delivered by Owner</Name>"
        b"<Type>Start Milestone</Type><PlannedDuration>0</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<StartDate>2010-09-01T08:00:00</StartDate><FinishDate>2010-09-01T08:00:00</FinishDate>"
        b"<ActualStartDate>2010-09-01T08:00:00</ActualStartDate><ActualFinishDate>2010-09-01T08:00:00</ActualFinishDate>"
        b"</Activity></Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    summary = await import_pmxml(db, project.id, parsed)

    activities = (await db.execute(
        select(Activity).where(Activity.schedule_period_id == summary.schedule_period_id)
    )).scalars().all()
    milestone = next(a for a in activities if a.task_name == "Building Pad Delivered by Owner")
    assert milestone.status == "completed"
    # Real 2010 delivery date preserved — NOT rescheduled forward to the
    # file's own 2011-05-01 DataDate.
    assert milestone.start == datetime(2010, 9, 1, 8, 0)
    assert milestone.finish == datetime(2010, 9, 1, 8, 0)


async def test_duplicate_resource_assignment_same_units_is_deduplicated_not_double_counted(
    db: AsyncSession, project: Project,
):
    """Real, serious BAC bug (2026-09-06, per Maro: "you're saying its 5m??"
    — a real file's total BAC was £5,088,728 where P6's own report said
    £3,605,744.44). Traced to a genuine data-export artifact: 73
    (Activity, Resource) pairs in the real file each had a byte-identical
    second <ResourceAssignment> element — same PlannedUnits, same
    PlannedCost, only the ObjectId and a ~1-hour StartDate/FinishDate
    difference distinguished them. Removing exactly those duplicates
    reproduced P6's own total to the penny. A second assignment for the
    same (activity, resource) pair with the SAME units isn't a genuinely
    separate real-world assignment — it's the same one recorded twice."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Resource><ObjectId>50</ObjectId><Name>Framer</Name><ResourceType>Labor</ResourceType></Resource>"
        b"<ResourceRate><ResourceObjectId>50</ResourceObjectId><PricePerUnit>50</PricePerUnit></ResourceRate>"
        b"<Project><ObjectId>1</ObjectId><Id>Dup Assignment Test</Id><DataDate>2011-05-01T00:00:00</DataDate>"
        b"<Activity><ObjectId>100</ObjectId><Id>A1</Id><Name>Unit Finishes</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>80</PlannedDuration><PercentComplete>0</PercentComplete></Activity>"
        b"<ResourceAssignment><ObjectId>1</ObjectId><ActivityObjectId>100</ActivityObjectId><ResourceObjectId>50</ResourceObjectId>"
        b"<PlannedUnits>80</PlannedUnits></ResourceAssignment>"
        b"<ResourceAssignment><ObjectId>2</ObjectId><ActivityObjectId>100</ActivityObjectId><ResourceObjectId>50</ResourceObjectId>"
        b"<PlannedUnits>80</PlannedUnits></ResourceAssignment>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    summary = await import_pmxml(db, project.id, parsed)

    assert summary.assignment_count == 1
    assert any("Duplicate resource assignment" in note for note in summary.skipped)

    activity = (await db.execute(
        select(Activity).where(Activity.project_id == project.id, Activity.task_name == "Unit Finishes")
    )).scalar_one()
    assignment = (await db.execute(
        select(ResourceAssignment).where(ResourceAssignment.activity_id == activity.id)
    )).scalar_one()
    resource = await db.get(Resource, assignment.resource_id)
    budget = compute_assignment_budget(resource, activity, assignment, Decimal(8))
    # £50/hr -> £400/day (x8h default calendar) x 10 days (80h/8h-per-day) x
    # 100% utilisation = £4,000 — not £8,000 if double-counted.
    assert budget == Decimal("4000.00")


async def test_actual_cost_applied_via_the_canonical_sync_activity_actuals_path(db: AsyncSession, project: Project):
    """A third real gap found the same day: AC/CV/CPI/EAC/ETC all stayed
    blank on a real import despite a fully-costed schedule — the importer
    captured BAC from resource assignments but had no mechanism for AC at
    all (2026-09-04, per Maro: "AC is blank... something very wrong").

    P6's own <Activity> carries its own already-rolled-up ActualLaborCost/
    ActualNonLaborCost (confirmed against a real activity: 49500 + 0,
    matching the flat P6 Excel report's own Actual Cost column exactly).
    But the Cost Element these actuals belong on doesn't exist until this
    variant is promoted to master (sync_cost_element_from_resources's own
    is_master gate), so p6_import.py stashes them as a "P6 Actual Cost"
    UDF at import time and promote_variant applies it once the element is
    actually created — via cost_sync.sync_activity_actuals, the exact same
    function Scheduling's own "record Actual Cost against a resourced
    activity" feature already uses (per Maro: "actuals are derived from
    the actual cost/resources spent etc. so it all has to align
    intelligently... credibility is paramount" — this is that alignment:
    the same single write path a human user would go through, not a
    second, independently-invented one)."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Resource><ObjectId>50</ObjectId><Name>J. Davies</Name><ResourceType>Labor</ResourceType></Resource>"
        b"<Project><ObjectId>1</ObjectId><Id>Actuals Test</Id><DataDate>2011-05-01T00:00:00</DataDate>"
        b"<Activity><ObjectId>100</ObjectId><Id>A1</Id><Name>Foundation</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>40</PlannedDuration><PercentComplete>1</PercentComplete>"
        b"<StartDate>2011-01-01T08:00:00</StartDate><FinishDate>2011-01-06T17:00:00</FinishDate>"
        b"<ActualStartDate>2011-01-01T08:00:00</ActualStartDate><ActualFinishDate>2011-01-06T17:00:00</ActualFinishDate>"
        b"<ActualLaborCost>4950</ActualLaborCost><ActualNonLaborCost>50</ActualNonLaborCost>"
        b"</Activity>"
        b"<ResourceAssignment><ActivityObjectId>100</ActivityObjectId><ResourceObjectId>50</ResourceObjectId>"
        b"<PlannedUnits>40</PlannedUnits></ResourceAssignment>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    summary = await import_pmxml(db, project.id, parsed)

    # Not yet promoted — nothing exists to apply actuals onto yet, same gate
    # sync_cost_element_from_resources itself already enforces.
    elements_before = (await db.execute(
        select(CostElement).where(CostElement.project_id == project.id)
    )).scalars().all()
    assert elements_before == []

    await schedule_variant_svc.promote_variant(db, summary.schedule_variant_id)

    element = (await db.execute(
        select(CostElement).where(CostElement.project_id == project.id, CostElement.source == "schedule")
    )).scalar_one()
    assert element.actuals == Decimal("5000.00")  # 4950 + 50, exactly P6's own reported total


async def test_imported_assignment_utilisation_reproduces_the_files_own_bac_exactly(db: AsyncSession, project: Project):
    """Real production BAC mismatch (2026-09-05, per Maro: comparing a
    Prosota BAC to P6's own report, "why are they different") — a genuine
    P6 export's own EC2080 "Pool & Deck": 1416h activity, one labour
    assignment of 840 hours at £105/hr (£88,200 flat, PlannedCost in the raw
    file). 840/1416 is 59.322033...%, not a round 2dp percentage — the old
    Numeric(5,2) utilisation_pct column rounded it to 59.32%, which multiplied
    back out through duration_days x utilisation_pct/100 x rate as
    £88,196.98, a real ~£3 miss on one activity alone. utilisation_pct is now
    Numeric(9,6) so the round trip reproduces the file's own BAC exactly."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Resource><ObjectId>50</ObjectId><Name>Pool Installation Subcontractor</Name><ResourceType>Labor</ResourceType></Resource>"
        b"<ResourceRate><ResourceObjectId>50</ResourceObjectId><PricePerUnit>105</PricePerUnit></ResourceRate>"
        b"<Project><ObjectId>1</ObjectId><Id>BAC Precision Test</Id><DataDate>2012-06-01T00:00:00</DataDate>"
        b"<Activity><ObjectId>100</ObjectId><Id>EC2080</Id><Name>Pool &amp; Deck</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>1416</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<StartDate>2012-06-28T10:40:00</StartDate><FinishDate>2013-03-11T10:40:00</FinishDate>"
        b"</Activity>"
        b"<ResourceAssignment><ActivityObjectId>100</ActivityObjectId><ResourceObjectId>50</ResourceObjectId>"
        b"<PlannedUnits>840</PlannedUnits></ResourceAssignment>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    await import_pmxml(db, project.id, parsed)

    activity = (await db.execute(
        select(Activity).where(Activity.project_id == project.id, Activity.task_name == "Pool & Deck")
    )).scalar_one()
    assignment = (await db.execute(
        select(ResourceAssignment).where(ResourceAssignment.activity_id == activity.id)
    )).scalar_one()
    resource = await db.get(Resource, assignment.resource_id)

    exact_utilisation = Decimal(840) / Decimal(1416) * Decimal(100)
    assert abs(assignment.utilisation_pct - exact_utilisation) < Decimal("0.0001")

    budget = compute_assignment_budget(resource, activity, assignment, Decimal(8))
    assert budget == Decimal("88200.00")
    old_rounded_budget = (
        Decimal(str(activity.duration_hours)) / Decimal(8) * Decimal("59.32") / Decimal(100) * resource.rate
    ).quantize(Decimal("0.01"))
    assert old_rounded_budget == Decimal("88196.98")  # what Numeric(5,2) used to produce
    assert budget != old_rounded_budget


async def test_imported_default_calendar_overrides_a_preexisting_project_default(db: AsyncSession, project: Project):
    """The exact real production scenario found 2026-09-04: the project
    already had Prosota's own lazy-seeded "Standard Calendar" (is_project_
    default=True) from an earlier, unrelated visit to Scheduling/Resources
    *before* the P6 import ran — the old "only fill in a default if the
    project doesn't already have one" rule saw that pre-existing default
    and left every genuinely-imported calendar (and the schedule that
    actually uses them) on Prosota's own placeholder instead. The file's
    own explicit default must win regardless."""
    existing = Calendar(id=uuid.uuid4(), project_id=project.id, name="Standard Calendar", is_project_default=True)
    db.add(existing)
    await db.commit()

    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Calendar><ObjectId>1</ObjectId><Name>Trades</Name><IsDefault>0</IsDefault></Calendar>"
        b"<Project><Id>Cal Override Test</Id><ActivityDefaultCalendarObjectId>1</ActivityDefaultCalendarObjectId>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    await import_pmxml(db, project.id, parsed)

    calendars = (await db.execute(select(Calendar).where(Calendar.project_id == project.id))).scalars().all()
    by_name = {c.name: c for c in calendars}
    assert by_name["Trades"].is_project_default is True
    assert by_name["Standard Calendar"].is_project_default is False


def test_default_calendar_from_project_activity_default_not_per_calendar_isdefault():
    """A real P6 file routinely writes <IsDefault>0</IsDefault> on every
    single <Calendar> (confirmed against a real export) — the project's
    real default comes from <Project>'s own ActivityDefaultCalendarObjectId
    instead (2026-09-04, per Maro: "you still use the default prosota
    calendar when you should be using everything from the imported
    dataset"). Two calendars, neither self-marked default; the project
    points at the second one."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Calendar><ObjectId>1</ObjectId><Name>Corporate</Name><IsDefault>0</IsDefault></Calendar>"
        b"<Calendar><ObjectId>2</ObjectId><Name>Trades</Name><IsDefault>0</IsDefault></Calendar>"
        b"<Project><Id>Cal Test</Id><ActivityDefaultCalendarObjectId>2</ActivityDefaultCalendarObjectId>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    by_id = {c.object_id: c for c in parsed.calendars}
    assert by_id["1"].is_default is False
    assert by_id["2"].is_default is True


def test_external_placeholder_projects_are_skipped_not_imported_as_the_real_one():
    """Real, serious bug (2026-09-06, per Maro, a genuine P6 export —
    "Haitang.xml" — imported as 7 zero-duration activities all sitting on
    today's date with 0 relationships): P6 writes a bare <Project
    external="true"> placeholder — just Id/Name/ObjectId/Type stubs for
    each Activity it references, no dates/duration/logic at all — whenever
    the real project has a cross-project relationship to a DIFFERENT
    project's activity, and this file had two of them listed BEFORE the
    real project. Picking "just the first <Project> element" silently
    imported an empty shell. The real project is whichever one lacks
    external="true"."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b'<Project external="true"><Id>EXT1</Id><ObjectId>1</ObjectId>'
        b'<Activity><Id>X1</Id><Name>External stub</Name><ObjectId>100</ObjectId><Type>Task Dependent</Type></Activity>'
        b"</Project>"
        b'<Project external="true"><Id>EXT2</Id><ObjectId>2</ObjectId>'
        b'<Activity><Id>X2</Id><Name>Another external stub</Name><ObjectId>101</ObjectId><Type>Start Milestone</Type></Activity>'
        b"</Project>"
        b"<Project><Id>REAL1</Id><Name>The Real Project</Name><DataDate>2011-05-01T00:00:00</DataDate>"
        b'<Activity><ObjectId>200</ObjectId><Id>A1</Id><Name>Real Activity</Name><Type>Task Dependent</Type>'
        b"<PlannedDuration>40</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<StartDate>2011-05-02T08:00:00</StartDate><FinishDate>2011-05-06T17:00:00</FinishDate></Activity>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    assert parsed.project_name == "The Real Project"
    assert len(parsed.activities) == 1
    assert parsed.activities[0].name == "Real Activity"
    assert parsed.activities[0].duration_hours == Decimal(40)
    assert parsed.skipped == []


def test_wbs_summary_activity_type_imports_as_task_not_skipped():
    """P6's "WBS Summary" ACTIVITY type (a real umbrella/roll-up task, see
    this module's own _ACTIVITY_TYPE_BY_NAME header for why it's a
    completely different concept from Prosota's activity_type=="wbs_summary")
    used to fall through the unrecognised-type branch and get flagged in
    `skipped` (2026-09-04, per Maro's own screenshot of P6's Activity Type
    dropdown, pointing out this exact confusion)."""
    xml = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Project><Id>WBS Summary Test</Id>"
        b'<Activity><ObjectId>1</ObjectId><Id>A1</Id><Name>Curbing</Name><Type>WBS Summary</Type>'
        b"<PlannedDuration>40</PlannedDuration><PercentComplete>0</PercentComplete></Activity>"
        b"</Project></APIBusinessObjects>"
    )
    parsed = parse_pmxml(xml)
    assert parsed.skipped == []
    assert parsed.activities[0].activity_type == "task"


async def test_p6_import_404_for_unknown_project(client: AsyncClient):
    if not _R2_CONFIGURED:
        pytest.skip("R2 credentials not configured in this environment")
    from app.services import object_storage

    valid_but_empty = (
        b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
        b"<Project><Id>Ghost Project</Id></Project>"
        b"</APIBusinessObjects>"
    )
    storage_key = object_storage.generate_storage_key("p6-imports", "ghost.xml")
    object_storage.upload_bytes(storage_key, valid_but_empty, "application/xml")
    resp = await client.post(
        "/api/v1/p6-import/xml",
        json={"project_id": str(uuid.uuid4()), "storage_key": storage_key},
    )
    assert resp.status_code == 404


async def test_p6_import_422s_for_malformed_xml(client: AsyncClient, project: Project):
    if not _R2_CONFIGURED:
        pytest.skip("R2 credentials not configured in this environment")
    from app.services import object_storage

    storage_key = object_storage.generate_storage_key("p6-imports", "bad.xml")
    object_storage.upload_bytes(storage_key, b"not xml at all", "application/xml")
    resp = await client.post(
        "/api/v1/p6-import/xml",
        json={"project_id": str(project.id), "storage_key": storage_key},
    )
    assert resp.status_code == 422


async def test_p6_import_presign_returns_upload_url(client: AsyncClient):
    if not _R2_CONFIGURED:
        pytest.skip("R2 credentials not configured in this environment")
    # 2026-09-03 — the presign step itself: confirms the endpoint returns a
    # real storage_key + upload_url shape without needing to actually PUT
    # through it (that's exercised for real by every _import_xml call above,
    # which uploads real bytes to the real object store first).
    resp = await client.post("/api/v1/p6-import/presign", json={"name": "schedule.xml"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["storage_key"].startswith("p6-imports/") and body["storage_key"].endswith(".xml")
    assert body["upload_url"].startswith("https://")
