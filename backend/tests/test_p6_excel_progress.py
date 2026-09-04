from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cost_element import CostElement
from app.models.project import Project
from app.models.schedule_period import SchedulePeriod
from app.services import schedule_variant as schedule_variant_svc
from app.services.p6_excel_progress import ParsedProgressRow, extract_date_from_filename
from app.services.p6_import import apply_progress_snapshot, import_pmxml
from app.services.p6_import_parse import parse_pmxml

_XML = (
    b'<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">'
    b"<Resource><ObjectId>50</ObjectId><Name>J. Davies</Name><ResourceType>Labor</ResourceType></Resource>"
    b"<Project><ObjectId>1</ObjectId><Id>Progress Test</Id><DataDate>2011-05-01T00:00:00</DataDate>"
    b"<Activity><ObjectId>100</ObjectId><Id>A1</Id><Name>Foundation</Name><Type>Task Dependent</Type>"
    b"<PlannedDuration>40</PlannedDuration><PercentComplete>0</PercentComplete>"
    b"<StartDate>2011-05-01T08:00:00</StartDate><FinishDate>2011-05-06T08:00:00</FinishDate></Activity>"
    b"<ResourceAssignment><ActivityObjectId>100</ActivityObjectId><ResourceObjectId>50</ResourceObjectId>"
    b"<PlannedUnits>40</PlannedUnits></ResourceAssignment>"
    b"</Project></APIBusinessObjects>"
)


def test_extract_date_from_filename():
    assert extract_date_from_filename("P6_Extract_2011-06-01.xlsx") == datetime(2011, 6, 1).date()
    assert extract_date_from_filename("no date here.xlsx") is None


async def test_apply_progress_snapshot_updates_matched_activity_and_cost_element(db: AsyncSession, project: Project):
    """End-to-end: import (non-master, per import_pmxml's own "reviewable
    before touching anything real" design), promote to master (which,
    since 2026-09-04's own fix, is what actually creates the resource-
    driven Cost Element), then apply one progress snapshot and confirm both
    the Activity and its linked Cost Element pick up the real P6-sourced
    numbers — not _apply_status_change's own generic "now" defaults."""
    parsed = parse_pmxml(_XML)
    summary = await import_pmxml(db, project.id, parsed)
    await schedule_variant_svc.promote_variant(db, summary.schedule_variant_id)

    activities = (await db.execute(
        select(Activity).where(Activity.schedule_period_id == summary.schedule_period_id)
    )).scalars().all()
    foundation = next(a for a in activities if a.task_name == "Foundation")
    element_before = (await db.execute(
        select(CostElement).where(CostElement.linked_activity_id == foundation.id)
    )).scalar_one()
    assert element_before.actuals is None

    row = ParsedProgressRow(
        activity_id="A1", status="In Progress",
        start=datetime(2011, 6, 1, 8, 0), finish=None,
        actual_cost=Decimal("5000"), earned_value_cost=Decimal("4000"), bac=Decimal("8000"),
    )
    result = await apply_progress_snapshot(
        db, project.id, summary.schedule_period_id, [row], as_of_date=date(2011, 6, 1),
    )
    assert result.matched == 1
    assert result.unmatched == []
    assert result.cost_elements_updated == 1

    await db.refresh(foundation)
    assert foundation.status == "in_progress"
    assert foundation.pct_complete == Decimal(50)  # EV/BAC = 4000/8000 = 50%
    assert foundation.actual_start == datetime(2011, 6, 1, 8, 0)
    assert foundation.actual_finish is None

    await db.refresh(element_before)
    assert element_before.actuals == Decimal("5000.00")
    assert element_before.pct_complete == 50

    # The SchedulePeriod's own data-date anchor must advance to match this
    # snapshot's date — otherwise every PV/SPI figure the Scheduling grid
    # shows keeps evaluating against the *original* import's DataDate
    # forever (2026-09-04, per Maro's own real-data catch: "the current
    # working schedule is based on the October snapshot but the data date
    # is still 1st May").
    period = await db.get(SchedulePeriod, summary.schedule_period_id)
    assert period.start_date == date(2011, 6, 1)


async def test_apply_progress_snapshot_reports_unmatched_activity_id(db: AsyncSession, project: Project):
    parsed = parse_pmxml(_XML)
    summary = await import_pmxml(db, project.id, parsed)
    await schedule_variant_svc.promote_variant(db, summary.schedule_variant_id)

    row = ParsedProgressRow(
        activity_id="DOES-NOT-EXIST", status="Completed",
        start=datetime(2011, 6, 1), finish=datetime(2011, 6, 5),
        actual_cost=Decimal("100"), earned_value_cost=Decimal("100"), bac=Decimal("100"),
    )
    result = await apply_progress_snapshot(db, project.id, summary.schedule_period_id, [row])
    assert result.matched == 0
    assert result.unmatched == ["DOES-NOT-EXIST"]
