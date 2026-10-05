import unittest
import uuid
from unittest.mock import AsyncMock, Mock, patch
from fastapi import HTTPException
import httpx
from app.ai.resource_context import get_context
from app.ai.openai_transport import _error_detail
from app.ai import orchestrator
from app.ai.openai_client import parse_response


def rows(values):
    return Mock(mappings=Mock(return_value=Mock(all=Mock(return_value=values))))


class ResourceContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_schedule_without_ifc_includes_existing_assignments(self):
        project, schedule, aid, rid = (uuid.uuid4() for _ in range(4))
        db = AsyncMock()
        db.execute.side_effect = [rows([{"id": aid, "task_name": "Excavate foundations", "schedule_category": None}]),
            rows([{"id": rid, "name": "Groundworks crew"}]), rows([{"activity_id": aid, "resource_id": rid}]), rows([]), Mock(scalar_one=Mock(return_value=0))]
        result = await get_context(db, project, schedule)
        self.assertEqual(result["activities"][0]["task_name"], "Excavate foundations")
        self.assertEqual(result["assignments"][0]["resource_id"], str(rid))
        self.assertEqual(result["ifc_file_count"], 0)
        self.assertIsNone(result["next_activity_offset"])
        for call in db.execute.call_args_list:
            self.assertIn(project, call.args[0].compile().params.values())
        for index in (0, 2):
            self.assertIn(schedule, db.execute.call_args_list[index].args[0].compile().params.values())

    async def test_ifc_summaries_and_pagination_are_bounded(self):
        aid = uuid.uuid4()
        db = AsyncMock()
        db.execute.side_effect = [rows([{"id": aid}] * 51), rows([{"id": uuid.uuid4()}] * 101),
            rows([{"activity_id": aid}] * 501), rows([{"activity_id": aid, "element_count": 129065, "example_label": "Column"}]), Mock(scalar_one=Mock(return_value=2))]
        result = await get_context(db, uuid.uuid4(), uuid.uuid4(), 50, 100, 500)
        self.assertEqual(len(result["activities"]), 50)
        self.assertEqual(len(result["resources"]), 100)
        self.assertEqual(len(result["assignments"]), 500)
        self.assertEqual(result["next_activity_offset"], 100)
        self.assertEqual(result["next_resource_offset"], 200)
        self.assertEqual(result["next_assignment_offset"], 1000)
        self.assertEqual(result["ifc_links_for_activity_page"][0]["element_count"], 129065)

    async def test_checkpoint_survives_failure_after_context_read(self):
        response = parse_response({"status": "completed", "output": [{"type": "function_call", "call_id": "ctx1", "name": "get_resource_planning_context", "arguments": "{}"}]})
        checkpoint = AsyncMock()
        with patch.object(orchestrator, "run_turn", AsyncMock(side_effect=[response, HTTPException(429, "limited")])), patch.object(orchestrator, "_execute_server_tool", AsyncMock(return_value={"resources": [{"id": "saved-resource"}]})):
            with self.assertRaises(HTTPException):
                await orchestrator.run_agent_turn(None, [], uuid.uuid4(), None, None, [], checkpoint=checkpoint)
        checkpoint.assert_awaited_once()
        messages = checkpoint.call_args.args[0]
        self.assertEqual(messages[-1]["content"][0]["tool_use_id"], "ctx1")
        self.assertIn("saved-resource", messages[-1]["content"][0]["content"])

    def test_rate_limits_are_distinct_from_exhausted_credit(self):
        for code in ("insufficient_quota", "credit_balance_exhausted", "project_spend_limit_exceeded"):
            detail = _error_detail(httpx.Response(429, json={"error": {"code": code}}, headers={"retry-after": "10"}))
            self.assertIn("billing", detail)
            self.assertNotIn("Retry after", detail)
        detail = _error_detail(httpx.Response(429, json={"error": {"code": "rate_limit_exceeded"}}, headers={"retry-after": "30"}))
        self.assertIn("30 seconds", detail)
        self.assertNotIn("billing", detail)

if __name__ == "__main__": unittest.main()
