import unittest
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from fastapi import HTTPException
from app.services.ifc_planning_import import build_rows, restore, scalar_fields
from app.models.activity import Activity
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.cost_element import CostElement
from app.models.model_element_link import ModelElementLink


def snapshot():
    return dict(activities=[dict(id='a', code='T-001', task_name='Build', duration_hours='8', start='2026-10-05T08:00:00', finish='2026-10-05T17:00:00', is_critical='true', calendar_id='cal')],
        calendars=[dict(id='cal', name='Week', is_project_default='true', day_start_time='08:00:00', day_end_time='17:00:00')], breaks=[], exceptions=[],
        resources=[dict(id='r', name='Crew', resource_type='crew', unit='day', rate='250', max_hours_per_day='8')],
        assignments=[dict(activity_id='a', resource_id='r', utilisation_pct='50')], relationships=[],
        costs=[dict(code='C-001', description='Build', budget='125', actuals='25', linked_activity_id='a', source='schedule', qs_signoff_name='Untrusted approval')],
        links=[dict(activity_id='a', source_kind='ifc', element_ref='guid', element_label='Wall', animation_profile_id=str(uuid.uuid4()))])


class MappingTests(unittest.TestCase):
    def test_preserves_dates_amounts_links_with_new_scoped_ids(self):
        project, period, costs = uuid.uuid4(), SimpleNamespace(id=uuid.uuid4(),schedule_variant_id=uuid.uuid4()), uuid.uuid4()
        rows = build_rows(snapshot(),project,period,costs)
        find = lambda model: next(r for r in rows if isinstance(r,model))
        activity, resource, assignment, cost, link = map(find,(Activity,Resource,ResourceAssignment,CostElement,ModelElementLink))
        self.assertEqual(activity.start.isoformat(),'2026-10-05T08:00:00')
        self.assertEqual(activity.duration_hours,Decimal(8))
        self.assertEqual(activity.project_id,project)
        self.assertEqual(assignment.activity_id,activity.id)
        self.assertEqual(assignment.resource_id,resource.id)
        self.assertEqual(cost.budget,Decimal(125))
        self.assertEqual(cost.linked_activity_id,activity.id)
        self.assertEqual(cost.source,'manual')
        self.assertIsNone(cost.qs_signoff_name)
        self.assertEqual(link.activity_id,activity.id)
        self.assertEqual(link.element_ref,'guid')
        self.assertIsNone(link.animation_profile_id)

    def test_external_references_and_cycles_are_rejected(self):
        for edit in ('foreign','parent','dependency'):
            s=snapshot()
            if edit=='foreign': s['assignments'][0]['resource_id']='foreign'
            if edit=='parent': s['activities'][0]['parent_id']='a'
            if edit=='dependency': s['relationships']=[dict(predecessor_id='a',successor_id='a',relationship_type='FS',lag_hours=0)]
            with self.assertRaises(ValueError): build_rows(s,uuid.uuid4(),SimpleNamespace(id=uuid.uuid4(),schedule_variant_id=uuid.uuid4()),uuid.uuid4())


class TransactionTests(unittest.IsolatedAsyncioTestCase):
    def db(self, occupied=False):
        project=uuid.uuid4(); period=SimpleNamespace(id=uuid.uuid4(),schedule_variant_id=uuid.uuid4(),freeze_status='live',baseline_locked_flag=False)
        costs=SimpleNamespace(id=uuid.uuid4(),project_id=project,freeze_status='live',baseline_locked_flag=False)
        db=AsyncMock(); db.add_all=Mock()
        db.get.return_value=SimpleNamespace(id=period.schedule_variant_id,project_id=project)
        db.execute.side_effect=[Mock(scalar_one_or_none=Mock(return_value=period)),Mock(scalar_one_or_none=Mock(return_value=costs)),Mock(first=Mock(return_value=('existing',) if occupied else None)),Mock(first=Mock(return_value=None))]
        return db,project,period,costs

    async def test_repeated_import_cannot_overwrite_data(self):
        db,p,s,c=self.db(True)
        with self.assertRaises(HTTPException): await restore(db,p,s.id,c.id,snapshot())
        db.add_all.assert_not_called(); db.commit.assert_not_called()

    async def test_success_is_one_commit_and_failure_rolls_back(self):
        db,p,s,c=self.db()
        counts=await restore(db,p,s.id,c.id,snapshot())
        self.assertEqual(counts['activities'],1); db.commit.assert_awaited_once()
        self.assertEqual(s.start_date.isoformat(),'2026-10-05')
        db,p,s,c=self.db(); db.flush.side_effect=RuntimeError('database failed')
        with self.assertRaises(RuntimeError): await restore(db,p,s.id,c.id,snapshot())
        db.rollback.assert_awaited_once(); db.commit.assert_not_called()
