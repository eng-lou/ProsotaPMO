from pathlib import Path
from decimal import Decimal
from datetime import time
from collections import Counter
import xml.etree.ElementTree as ET
import pytest
from sqlalchemy import select
from app.models.activity import Activity
from app.models.resource_assignment import ResourceAssignment
from app.models.schedule_period import SchedulePeriod
from app.services.p6_import_parse import parse_pmxml
from app.services.p6_import import import_pmxml
from app.services.p6_export import gather_p6_export_data
from app.services.p6_export_xml import build_pmxml
from app.services.activity import list_activities
from app.models.schedule_baseline import ScheduleBaselineRelationship

SOURCE = Path(r"C:/Users/Maro/Documents/EVM/Juniper.xml")

@pytest.mark.skipif(not SOURCE.exists(), reason="User supplied Juniper XML is not installed")
async def test_juniper_import_export_fidelity(db, project):
    parsed = parse_pmxml(SOURCE.read_bytes())
    result = await import_pmxml(db, project.id, parsed)
    activities = (await db.execute(select(Activity).where(Activity.schedule_period_id == result.schedule_period_id))).scalars().all()
    leaves = {a.p6_data['Id']: a for a in activities if a.p6_data and a.activity_type != 'wbs_summary'}
    assert len(leaves) == len(parsed.activities) == 132
    for source in parsed.activities:
        actual = leaves[source.code]
        assert actual.start == source.start, source.code
        assert actual.finish == source.finish, source.code
        assert actual.actual_start == source.actual_start, source.code
        assert actual.actual_finish == source.actual_finish, source.code
    period = await db.get(SchedulePeriod, result.schedule_period_id)
    assert period.start_time == time(8)
    assignments = (await db.execute(select(ResourceAssignment).where(ResourceAssignment.activity_id.in_([a.id for a in leaves.values()])))).scalars().all()
    assert len(assignments) == 388
    assert sum(Decimal(a.p6_data['PlannedCost']) for a in assignments) == Decimal('5088728.294380')
    exported = await gather_p6_export_data(db, result.schedule_period_id)
    xml = build_pmxml(exported)
    reparsed = parse_pmxml(xml.encode())
    assert {a.code for a in reparsed.activities} == set(leaves)
    assert reparsed.data_time == time(8)
    assert len(reparsed.baselines) == 1
    assert reparsed.current_baseline_object_id == reparsed.baselines[0].object_id
    assert len(reparsed.assignments) == 388
    assert len(reparsed.wbs_nodes) == len(parsed.wbs_nodes) == 16
    baseline_links = (await db.execute(select(ScheduleBaselineRelationship))).scalars().all()
    assert len(baseline_links) == 216
    for before in parsed.calendars:
        after = next(c for c in reparsed.calendars if c.name == before.name)
        assert (before.day_start, before.day_end, before.breaks, before.works) == (after.day_start, after.day_end, after.breaks, after.works)
        assert before.exceptions == after.exceptions
    for before, after in zip(sorted(parsed.activities,key=lambda a:a.code), sorted(reparsed.activities,key=lambda a:a.code)):
        assert before.start == after.start, before.code
        assert before.finish == after.finish, before.code
        assert before.actuals == after.actuals, before.code
        assert before.remaining_duration_hours == after.remaining_duration_hours, before.code
        for field in ('PlannedLaborCost','ActualLaborCost','PlannedStartDate','PlannedFinishDate','GUID'):
            assert before.source_fields.get(field) == after.source_fields.get(field), (before.code,field)
    assert sum(a.budget for a in reparsed.baselines[0].activities) == Decimal('3605744.444264')
    displayed = await list_activities(db, project.id, result.schedule_period_id)
    root = next(a for a in displayed if a.parent_id is None)
    assert root.bl_start is not None and root.bl_finish is not None
    # User-confirmed P6 All Activities screenshot from the same saved state.
    expected = {'bac': '3605744.44', 'pv': '461639.09', 'ev': '457995.66',
                'ac': '482245.34', 'cv': '-24249.68', 'sv': '-3643.43',
                'eac': '3629809.03', 'etc': '3147563.69'}
    for key, value in expected.items():
        assert getattr(root, key) == Decimal(value), key
    assert root.start.isoformat() == '2010-11-01T07:00:00'
    assert root.finish.isoformat() == '2014-01-10T09:48:00'
    assert root.bl_start.isoformat() == '2010-11-01T08:00:00'
    assert root.bl_finish.isoformat() == '2013-12-13T13:48:00'
    building = next(a for a in displayed if a.task_name == 'Building 1')
    assert building.bac == Decimal('1152470.54')
    assert building.eac == Decimal('1153455.54')
    # Compare complete project records, including references and auxiliary
    # records that are invisible in the normal activity table.
    source_tree = ET.fromstring(SOURCE.read_bytes())
    output_tree = ET.fromstring(xml)
    for tree in (source_tree, output_tree):
        for node in tree.iter():
            node.tag = node.tag.split('}')[-1]
    assert Counter(e.tag for e in source_tree) == Counter(e.tag for e in output_tree)
    for kind in ('Activity', 'WBS', 'ResourceAssignment', 'Calendar', 'Resource'):
        key = 'Id' if kind in ('Activity', 'Resource') else 'Name' if kind == 'Calendar' else 'GUID'
        def records(tree):
            parent = tree.find('Project') if kind in ('Activity', 'WBS', 'ResourceAssignment') else tree
            return {e.findtext(key): e for e in parent.findall(kind)}
        original, rebuilt = records(source_tree), records(output_tree)
        assert original.keys() == rebuilt.keys(), kind
        for identity, before in original.items():
            after = {e.tag: e.text for e in rebuilt[identity] if not len(e)}
            for field in before:
                if len(field) or field.tag.endswith('ObjectId'):
                    continue
                old, new = field.text, after.get(field.tag)
                if (old or '') == (new or ''):
                    continue
                try:
                    assert Decimal(old) == Decimal(new), (kind, identity, field.tag)
                except (TypeError, ArithmeticError):
                    pytest.fail(f'{kind} {identity}: {field.tag} changed from {old!r} to {new!r}')
    for tag in ('ActivityStep', 'ActivityPeriodActual', 'ResourceAssignmentPeriodActual', 'ProjectSpendingPlan', 'Document'):
        assert len(source_tree.find('Project').findall(tag)) == len(output_tree.find('Project').findall(tag)), tag
    for tag in ('Activity', 'WBS', 'Calendar', 'Resource', 'CostAccount'):
        ids = {e.findtext('ObjectId') for e in output_tree.iter(tag)}
        assert all(not e.text or e.text in ids for e in output_tree.iter(tag + 'ObjectId')), tag
    # Promotion must carry the approved P6 budget into Cost Plan as well.
    from app.services.schedule_variant import promote_variant
    from app.models.cost_element import CostElement
    await promote_variant(db, result.schedule_variant_id)
    cost_rows = (await db.execute(select(CostElement).where(CostElement.project_id == project.id))).scalars().all()
    assert sum((c.bl_budget or Decimal(0) for c in cost_rows), Decimal(0)).quantize(Decimal('.01')) == Decimal('3605744.44')
    after_promotion = await list_activities(db, project.id, result.schedule_period_id)
    promoted_root = next(a for a in after_promotion if a.parent_id is None)
    for key, value in expected.items():
        assert getattr(promoted_root, key) == Decimal(value), ('promoted', key)

    # Retain a review artifact locally; no source data is copied into fixtures.
    dest = Path(__file__).resolve().parents[2] / 'outputs/p6-fidelity'
    dest.mkdir(parents=True,exist_ok=True)
    (dest/'Juniper-fixed-roundtrip.xml').write_text(xml,encoding='utf-8')
    import json
    columns = ('bac', 'pv', 'ev', 'ac', 'cv', 'sv', 'cpi', 'spi', 'eac', 'etc')
    report = {'unfiltered': {k: str(getattr(root,k,None)) for k in columns}, 'matches_user_unfiltered_p6_screenshot': True}
    (dest/'Juniper-comparison.json').write_text(json.dumps(report,indent=2),encoding='utf-8')


async def test_small_p6_snapshot_preserves_baseline_costs_calendar_and_distinct_assignments(db, project):
    xml = b'''<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects">
    <Calendar><ObjectId>9</ObjectId><Name>Five days</Name><HoursPerDay>8</HoursPerDay><HoursPerMonth>172</HoursPerMonth>
      <StandardWorkWeek><StandardWorkHours><DayOfWeek>Monday</DayOfWeek><WorkTime><Start>08:00:00</Start><Finish>15:59:00</Finish></WorkTime></StandardWorkHours></StandardWorkWeek></Calendar>
    <Resource><ObjectId>5</ObjectId><Id>CREW-01</Id><Name>Crew</Name><ResourceType>Labor</ResourceType><CalendarObjectId>9</CalendarObjectId></Resource>
    <ResourceRate><ObjectId>6</ObjectId><ResourceObjectId>5</ResourceObjectId><PricePerUnit>50</PricePerUnit></ResourceRate>
    <Project><ObjectId>100</ObjectId><Id>P6-01</Id><Name>Source</Name><DataDate>2026-10-05T08:00:00</DataDate><ActivityDefaultCalendarObjectId>9</ActivityDefaultCalendarObjectId><CurrentBaselineProjectObjectId>200</CurrentBaselineProjectObjectId>
    <WBS><ObjectId>11</ObjectId><Code>STRUCT</Code><Name>Structure</Name><SequenceNumber>8</SequenceNumber><EarnedValueComputeType>Activity Percent Complete</EarnedValueComputeType></WBS>
    <Activity><ObjectId>12</ObjectId><Id>A100</Id><GUID>activity-guid</GUID><Name>Pour</Name><Type>Task Dependent</Type><WBSObjectId>11</WBSObjectId><CalendarObjectId>9</CalendarObjectId><PlannedDuration>8</PlannedDuration><StartDate>2026-10-12T08:00:00</StartDate><FinishDate>2026-10-12T16:00:00</FinishDate><PlannedLaborCost>123.45678</PlannedLaborCost><ActualLaborCost>0</ActualLaborCost><PercentComplete>0</PercentComplete><TotalFloat>16</TotalFloat></Activity>
    <ResourceAssignment><ObjectId>21</ObjectId><ActivityObjectId>12</ActivityObjectId><ResourceObjectId>5</ResourceObjectId><PlannedUnits>1</PlannedUnits><PlannedCost>61.72839</PlannedCost></ResourceAssignment>
    <ResourceAssignment><ObjectId>22</ObjectId><ActivityObjectId>12</ActivityObjectId><ResourceObjectId>5</ResourceObjectId><PlannedUnits>1</PlannedUnits><PlannedCost>61.72839</PlannedCost></ResourceAssignment>
    </Project>
    <BaselineProject><ObjectId>200</ObjectId><OriginalProjectObjectId>100</OriginalProjectObjectId><Name>Approved</Name><DataDate>2026-10-05T08:00:00</DataDate><Activity><ObjectId>32</ObjectId><Id>A100</Id><CalendarObjectId>9</CalendarObjectId><StartDate>2026-10-05T08:00:00</StartDate><FinishDate>2026-10-05T16:00:00</FinishDate><PlannedDuration>8</PlannedDuration><PlannedLaborCost>100</PlannedLaborCost></Activity></BaselineProject>
    </APIBusinessObjects>'''
    parsed = parse_pmxml(xml)
    result = await import_pmxml(db, project.id, parsed)
    assert result.assignment_count == 2
    rows = await list_activities(db, project.id, result.schedule_period_id)
    leaf = next(a for a in rows if a.task_name == 'Pour')
    assert leaf.bac == Decimal('100.00')
    assert leaf.total_float_hours == 16
    assert leaf.start.isoformat() == '2026-10-12T08:00:00'
    output = build_pmxml(await gather_p6_export_data(db, result.schedule_period_id))
    back = parse_pmxml(output.encode())
    assert back.activities[0].code == 'A100'
    assert back.activities[0].source_fields['PlannedLaborCost'] == '123.45678'
    assert len(back.assignments) == 2
    assert back.baselines[0].activities[0].budget == 100
    assert next(c for c in back.calendars if c.name == 'Five days').day_end.hour == 16
    # An explicit progress edit must not be overwritten by the retained XML.
    from app.services.activity import update_activity
    from app.schemas.activity import ActivityUpdate
    await update_activity(db, leaf.id, ActivityUpdate(pct_complete=Decimal('25')))
    edited = parse_pmxml(build_pmxml(await gather_p6_export_data(db, result.schedule_period_id)).encode())
    assert edited.activities[0].pct_complete == 25
    assert Decimal(edited.activities[0].source_fields['PhysicalPercentComplete']) == Decimal('0.25')

    from app.services.resource_assignment import update_assignment
    from app.schemas.resource import ResourceAssignmentUpdate
    assignments = (await db.execute(select(ResourceAssignment).where(ResourceAssignment.activity_id == leaf.id))).scalars().all()
    await update_assignment(db, assignments[0].id, ResourceAssignmentUpdate(utilisation_pct=Decimal('50')))
    edited = parse_pmxml(build_pmxml(await gather_p6_export_data(db, result.schedule_period_id)).encode())
    assert Decimal(edited.activities[0].source_fields['PlannedLaborCost']) == Decimal('261.72839')

    # A second import can reuse identical shared definitions without relying
    # on unique names or changing the first variant's edited resource plan.
    from app.models.resource import Resource
    from app.models.calendar import Calendar
    before_resources = {r.id for r in (await db.execute(select(Resource).where(Resource.project_id == project.id))).scalars().all()}
    before_calendars = {c.id for c in (await db.execute(select(Calendar).where(Calendar.project_id == project.id))).scalars().all()}
    await import_pmxml(db, project.id, parsed)
    assert {r.id for r in (await db.execute(select(Resource).where(Resource.project_id == project.id))).scalars().all()} == before_resources
    assert {c.id for c in (await db.execute(select(Calendar).where(Calendar.project_id == project.id))).scalars().all()} == before_calendars
