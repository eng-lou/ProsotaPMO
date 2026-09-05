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
from app.models.schedule_baseline import ScheduleBaseline, ScheduleBaselineActivity
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_variant import ScheduleVariant
from app.models.user import User
from app.models.user_defined_field import UserDefinedFieldDefinition, UserDefinedFieldValue
from app.services import schedule_variant as schedule_variant_svc
from app.services.p6_import import import_pmxml
from app.services.p6_import_parse import parse_pmxml
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

    Also covers a not-yet-reached milestone (0% complete, no duration of
    its own — its CPM position is purely relationship-driven, the same
    class of P6-vs-Prosota network divergence, and it's very often the
    schedule's own overall "when does this finish" marker) getting the
    same trusted-finish treatment regardless of % complete."""
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
        b"<StartDate>2011-06-01T08:00:00</StartDate><FinishDate>2099-01-01T08:00:00</FinishDate>"
        b"<ActualStartDate>2011-06-01T08:00:00</ActualStartDate>"
        b"</Activity>"
        b"<Activity><ObjectId>3</ObjectId><Id>A3</Id><Name>Not Started Yet</Name><Type>Task Dependent</Type>"
        b"<PlannedDuration>40</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<StartDate>2097-03-01T10:40:00</StartDate><FinishDate>2097-03-06T10:40:00</FinishDate>"
        b"</Activity>"
        b"<Activity><ObjectId>4</ObjectId><Id>A4</Id><Name>Overall Finish</Name><Type>Finish Milestone</Type>"
        b"<PlannedDuration>0</PlannedDuration><PercentComplete>0</PercentComplete>"
        b"<FinishDate>2098-06-15T10:40:00</FinishDate>"
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
    # The absurd 2099 date is deliberate — proves this is genuinely trusted
    # from the file, not coincidentally matching whatever CPM would have
    # computed from duration+calendar on its own.
    assert in_progress.finish == datetime(2099, 1, 1, 8, 0)

    not_started = next(a for a in activities if a.task_name == "Not Started Yet")
    assert not_started.status == "planned"
    # 2026-09-05, per Maro: real dates compared line-by-line against P6's
    # own report found a plain, 0%-complete, non-milestone, no-predecessor
    # task landing on Prosota's own from-scratch CPM position (which, with
    # no predecessors at all, would schedule it at/near the project's data
    # date) rather than P6's own stated dates — the same "Prosota's own
    # duration+calendar math can't bit-for-bit reproduce P6's engine"
    # limitation applies to every activity, not just progressed/milestone
    # ones. The absurd 2097 dates are deliberate — this activity has no
    # predecessors, so CPM would otherwise place it at/near the 2011 data
    # date, nowhere near here.
    assert not_started.start == datetime(2097, 3, 1, 10, 40)
    assert not_started.finish == datetime(2097, 3, 6, 10, 40)

    milestone = next(a for a in activities if a.task_name == "Overall Finish")
    assert milestone.status == "planned"
    assert milestone.finish == datetime(2098, 6, 15, 10, 40)


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
