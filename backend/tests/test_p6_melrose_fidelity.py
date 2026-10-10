from pathlib import Path
from decimal import Decimal
import pytest
from app.services.p6_import_parse import parse_pmxml
from app.services.p6_import import import_pmxml
from app.services.activity import list_activities, get_activity
from app.models.activity import Activity
from sqlalchemy import update

SOURCE = Path(r'C:/Users/Maro/Documents/EVM/Melrose.xml')

@pytest.mark.skipif(not SOURCE.exists(), reason='User supplied Melrose XML is not installed')
async def test_melrose_import_displays_durations_without_rescheduling(db, project):
    parsed = parse_pmxml(SOURCE.read_bytes())
    source = next(a for a in parsed.activities if a.code == 'MN1020')
    assert source.duration_hours == Decimal('120')
    result = await import_pmxml(db, project.id, parsed)
    rows = await list_activities(db, project.id, result.schedule_period_id)
    task = next(a for a in rows if (a.p6_data or {}).get('Id') == 'MN1020')
    assert task.duration_hours == Decimal('120')
    assert task.start == source.start
    assert task.finish == source.finish
    assert task.duration_days == Decimal('15')
    for row in rows:
        if row.activity_type != 'wbs_summary' and row.duration_hours is not None:
            assert row.duration_days is not None, row.task_name

    # Existing imports with a missing display cache are repaired on read too.
    await db.execute(update(Activity).where(Activity.id == task.id).values(duration_days=None))
    await db.commit()
    await db.refresh(task)
    assert task.duration_days is None
    loaded = await get_activity(db, task.id)
    assert loaded.duration_days == Decimal('15')
    assert loaded.duration_hours == Decimal('120')
    assert loaded.finish == source.finish


@pytest.mark.skipif(not SOURCE.exists(), reason='User supplied Melrose XML is not installed')
async def test_melrose_costs_use_current_project_not_unassigned_baseline(db, project):
    from sqlalchemy import select
    from app.models.schedule_baseline import ScheduleBaseline
    from app.services.schedule_variant import promote_variant
    parsed = parse_pmxml(SOURCE.read_bytes())
    assert parsed.baseline_assignment_specified
    assert parsed.current_baseline_object_id is None
    result = await import_pmxml(db, project.id, parsed)
    baselines = (await db.execute(select(ScheduleBaseline).where(
        ScheduleBaseline.schedule_period_id == result.schedule_period_id))).scalars().all()
    assert len(baselines) == 1
    assert not baselines[0].is_active
    for promoted in (False, True):
        if promoted:
            await promote_variant(db, result.schedule_variant_id)
        rows = await list_activities(db, project.id, result.schedule_period_id)
        root = next(a for a in rows if a.parent_id is None)
        assert root.bac == Decimal('1054973.66'), ('root', promoted, root.bac)
        assert root.eac == root.bac and root.etc == root.bac
        for row in rows:
            code = (row.p6_data or {}).get('Id')
            original = next((a for a in parsed.activities if a.code == code), None)
            if original is None:
                continue
            expected = sum((Decimal(original.source_fields.get(k) or 0) for k in (
                'PlannedLaborCost','PlannedNonLaborCost','PlannedMaterialCost','PlannedExpenseCost')), Decimal(0))
            assert abs(row.bac - expected) <= Decimal('.005'), (code, promoted, row.bac, expected)
            assert row.pv == 0 and row.ev == 0 and row.ac == 0, code

@pytest.mark.parametrize('assignment,assigned', [('', False), ('2', True)])
async def test_explicit_p6_baseline_assignment(db, project, assignment, assigned):
    from sqlalchemy import select
    from app.models.schedule_baseline import ScheduleBaseline
    xml = f'''<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">
      <Project><ObjectId>1</ObjectId><Id>TEST</Id><Name>Baseline selection</Name>
        <DataDate>2026-02-02T08:00:00</DataDate>
        <CurrentBaselineProjectObjectId>{assignment}</CurrentBaselineProjectObjectId>
        <Activity><ObjectId>100</ObjectId><Id>A1</Id><Name>Task</Name><Type>Task Dependent</Type>
          <PlannedDuration>120</PlannedDuration><PlannedLaborCost>4600.2</PlannedLaborCost>
          <StartDate>2026-02-02T08:00:00</StartDate><FinishDate>2026-02-20T17:00:00</FinishDate>
        </Activity>
      </Project>
      <BaselineProject><ObjectId>2</ObjectId><OriginalProjectObjectId>1</OriginalProjectObjectId>
        <Name>Old budget</Name><DataDate>2026-02-02T08:00:00</DataDate>
        <Activity><ObjectId>200</ObjectId><Id>A1</Id><Name>Task</Name>
          <PlannedDuration>120</PlannedDuration><PlannedLaborCost>4554.198</PlannedLaborCost>
          <StartDate>2026-02-02T08:00:00</StartDate><FinishDate>2026-02-20T17:00:00</FinishDate>
        </Activity>
      </BaselineProject></APIBusinessObjects>'''.encode()
    result = await import_pmxml(db, project.id, parse_pmxml(xml))
    baseline = (await db.execute(select(ScheduleBaseline).where(
        ScheduleBaseline.schedule_period_id == result.schedule_period_id))).scalar_one()
    assert baseline.is_active == assigned
    rows = await list_activities(db, project.id, result.schedule_period_id)
    task = next(a for a in rows if a.task_name == 'Task')
    assert task.bac == Decimal('4554.198' if assigned else '4600.2')


@pytest.mark.skipif(not SOURCE.exists(), reason='User supplied Melrose XML is not installed')
async def test_melrose_assigned_baseline_keeps_remaining_cost_forecast(db, project):
    from app.services.schedule_variant import promote_variant
    parsed = parse_pmxml(SOURCE.read_bytes())
    parsed.current_baseline_object_id = parsed.baselines[0].object_id
    result = await import_pmxml(db, project.id, parsed)
    for promoted in (False, True):
        if promoted:
            await promote_variant(db, result.schedule_variant_id)
        rows = await list_activities(db, project.id, result.schedule_period_id)
        root = next(a for a in rows if a.parent_id is None)
        task = next(a for a in rows if (a.p6_data or {}).get('Id') == 'MN1020')
        assert root.bac == root.bl_budget == Decimal('1055038.71')
        assert root.eac == root.etc == Decimal('1054973.66')
        assert task.bac == Decimal('4554.198')
        assert task.eac == task.etc == Decimal('4600.2')
