from __future__ import annotations

import pathlib
import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.activity import Activity
from app.models.calendar import Calendar, CalendarBreak
from app.models.organisation import Organisation
from app.models.project import Project
from app.models.resource import Resource
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_variant import ScheduleVariant
from app.models.user import User
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
    # name) above whatever WBS the schedule itself has — so the round trip
    # is that root + "Structure" + 2 tasks = 4, not 3.
    assert summary["activity_count"] == 4
    assert summary["relationship_count"] == 1
    assert summary["resource_count"] == 1
    assert summary["assignment_count"] == 1
    assert summary["calendar_count"] == 1
    assert summary["udf_value_count"] == 1
    assert summary["skipped"] == []

    variant_id = uuid.UUID(summary["schedule_variant_id"])
    variant = await db.get(ScheduleVariant, variant_id)
    assert variant is not None
    assert variant.project_id == target_project.id
    assert variant.is_master is False

    activities = (await db.execute(
        select(Activity).where(Activity.schedule_variant_id == variant_id)
    )).scalars().all()
    names_by_task = {a.task_name: a for a in activities}
    assert set(names_by_task) == {"Test Project", "Structure", "Excavate & Prep", "Pour Concrete"}
    assert names_by_task["Structure"].activity_type == "wbs_summary"

    task_a = names_by_task["Excavate & Prep"]
    assert task_a.commentary == "Watch out for the buried services."
    assert task_a.duration_hours == Decimal("32.00")
    assert task_a.parent_id == names_by_task["Structure"].id

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
