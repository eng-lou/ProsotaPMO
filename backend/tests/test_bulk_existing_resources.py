import unittest
import uuid
from unittest.mock import AsyncMock, Mock
from fastapi import HTTPException
from app.schemas.schedule_bulk_generate import BulkResourceInput
from app.services.schedule_bulk_generate import resolve_existing_resources


class ExistingResourcesTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_id_is_scoped_and_reused(self):
        rid, project = uuid.uuid4(), uuid.uuid4()
        db = AsyncMock()
        db.execute.return_value = Mock(all=Mock(return_value=[(rid, 'crew')]))
        resource = BulkResourceInput(temp_id='ref', existing_id=rid, name='Crew', resource_type='crew', unit='day', rate=250)
        self.assertEqual(await resolve_existing_resources(db, project, [resource]), {'ref': rid})
        self.assertIn(project, db.execute.call_args.args[0].compile().params.values())

    async def test_missing_or_changed_resource_is_rejected(self):
        rid = uuid.uuid4()
        resource = BulkResourceInput(temp_id='ref', existing_id=rid, name='Crew', resource_type='crew', unit='day', rate=250)
        for values in ([], [(rid, 'material')]):
            db = AsyncMock()
            db.execute.return_value = Mock(all=Mock(return_value=values))
            with self.assertRaises(HTTPException):
                await resolve_existing_resources(db, uuid.uuid4(), [resource])
