import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.api import schedule_variants as api


class ScheduleContextTests(unittest.IsolatedAsyncioTestCase):
    async def resolve(self, selection):
        project = uuid4()
        master = SimpleNamespace(id=uuid4(), project_id=project)
        alternative = SimpleNamespace(id=uuid4(), project_id=project)
        selected = {'master': master.id, 'alternative': alternative.id,
                    'foreign_or_deleted': uuid4(), 'none': None}[selection]
        period = object()
        db = object()
        with patch.object(api.svc, 'get_or_create_master', new=AsyncMock(return_value=master)) as bootstrap, \
             patch.object(api.svc, 'list_variants', new=AsyncMock(return_value=[master, alternative])) as listing, \
             patch.object(api.schedule_period, 'bootstrap_period', new=AsyncMock(return_value=period)) as periods:
            result = await api.schedule_context(project, selected, db)
        expected = alternative if selection == 'alternative' else master
        self.assertIs(result['variant'], expected)
        self.assertIs(result['period'], period)
        bootstrap.assert_awaited_once_with(db, project)
        periods.assert_awaited_once_with(db, expected.id)
        if selection in ('none', 'master'):
            listing.assert_not_awaited()
        else:
            listing.assert_awaited_once_with(db, project)

    async def test_empty_project_bootstraps_master_and_period(self):
        await self.resolve('none')

    async def test_saved_master_skips_variant_list(self):
        await self.resolve('master')

    async def test_saved_alternative_keeps_its_own_period(self):
        await self.resolve('alternative')

    async def test_foreign_or_deleted_selection_falls_back_to_master(self):
        await self.resolve('foreign_or_deleted')
