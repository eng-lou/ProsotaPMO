"""Profile-only edits preserve schedule guards without recalculating CPM.

Run without a database: python -m unittest tests.test_activity_profile_update
"""
import uuid
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.schemas.activity import ActivityUpdate
from app.services import activity as service


class ActivityProfileUpdateTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.activity = SimpleNamespace(
            id=uuid.uuid4(), project_id=uuid.uuid4(), schedule_period_id=uuid.uuid4(),
            code="A-001", animation_profile_id=uuid.uuid4(),
        )
        self.db = SimpleNamespace(commit=AsyncMock())
        self.mocks = {}
        for name in ("get_activity", "_require_live_schedule_period",
                     "_validate_animation_profile_in_project", "_attach_evm_fields",
                     "_recompute_hierarchy"):
            self.mocks[name] = self.stack.enter_context(patch.object(service, name, new_callable=AsyncMock))
        self.mocks["get_activity"].return_value = self.activity
        self.cpm = self.stack.enter_context(patch.object(service.scheduling_cpm, "recompute_schedule", new_callable=AsyncMock))

    async def test_assign_profile_without_recomputing_schedule(self):
        profile_id = uuid.uuid4()
        result = await service.update_activity(self.db, self.activity.id, ActivityUpdate(animation_profile_id=profile_id))
        self.assertIs(result, self.activity)
        self.assertEqual(result.animation_profile_id, profile_id)
        self.mocks["_require_live_schedule_period"].assert_awaited_once_with(self.db, self.activity.schedule_period_id)
        self.mocks["_validate_animation_profile_in_project"].assert_awaited_once_with(self.db, profile_id, self.activity.project_id)
        self.db.commit.assert_awaited_once()
        self.mocks["_attach_evm_fields"].assert_awaited_once_with(self.db, [self.activity])
        self.mocks["_recompute_hierarchy"].assert_not_awaited()
        self.cpm.assert_not_awaited()

    async def test_default_clears_profile(self):
        await service.update_activity(self.db, self.activity.id, ActivityUpdate(animation_profile_id=None))
        self.assertIsNone(self.activity.animation_profile_id)
        self.mocks["_validate_animation_profile_in_project"].assert_not_awaited()
        self.db.commit.assert_awaited_once()
        self.cpm.assert_not_awaited()

    async def test_profile_from_another_project_is_rejected(self):
        previous = self.activity.animation_profile_id
        self.mocks["_validate_animation_profile_in_project"].side_effect = HTTPException(422, "Wrong project")
        with self.assertRaises(HTTPException):
            await service.update_activity(self.db, self.activity.id, ActivityUpdate(animation_profile_id=uuid.uuid4()))
        self.assertEqual(self.activity.animation_profile_id, previous)
        self.db.commit.assert_not_awaited()

    async def test_baseline_cannot_be_edited(self):
        previous = self.activity.animation_profile_id
        self.mocks["_require_live_schedule_period"].side_effect = HTTPException(409, "Read-only baseline")
        with self.assertRaises(HTTPException):
            await service.update_activity(self.db, self.activity.id, ActivityUpdate(animation_profile_id=None))
        self.assertEqual(self.activity.animation_profile_id, previous)
        self.db.commit.assert_not_awaited()
