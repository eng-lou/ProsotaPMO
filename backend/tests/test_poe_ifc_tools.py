import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from app.ai import orchestrator
from app.ai.openai_client import parse_response
from app.ai.tools import CLIENT_TOOL_NAMES
from app.api.ai_chat import chat
from app.schemas.ai_chat import AiChatRequest


class IfcToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_live_readers_are_offered_in_chat(self):
        response = parse_response({"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "Ready"}]}]})
        for live in ([], ["get_loaded_ifc_models", "read_ifc_model"]):
            with patch.object(orchestrator, "run_turn", AsyncMock(return_value=response)) as turn:
                await orchestrator.run_agent_turn(None, [], uuid.uuid4(), None, None, live)
                names = {t["name"] for t in turn.call_args.args[2]}
                self.assertEqual("read_ifc_model" in names, bool(live))
                self.assertNotIn("submit_ifc_schedule", names)
        self.assertTrue({"read_ifc_model", "submit_ifc_schedule"} <= CLIENT_TOOL_NAMES)

    async def test_schedule_draft_only_exposes_readers_and_submission(self):
        response = parse_response({"status": "completed", "output": [{"type": "function_call", "call_id": "draft", "name": "submit_ifc_schedule", "arguments": "{}"}]})
        names = ["get_loaded_ifc_models", "read_ifc_model", "submit_ifc_schedule"]
        with patch.object(orchestrator, "run_turn", AsyncMock(return_value=response)) as turn:
            result = await orchestrator.run_agent_turn(None, [], uuid.uuid4(), None, None, names, purpose="ifc_schedule")
            self.assertEqual({t["name"] for t in turn.call_args.args[2]}, set(names))
            self.assertEqual(result.pending_client_tool_calls[0]["name"], "submit_ifc_schedule")

    async def test_unsupported_tool_cannot_escape_draft_scope(self):
        response = parse_response({"status": "completed", "output": [{"type": "function_call", "call_id": "bad", "name": "get_project_snapshot", "arguments": "{}"}]})
        with patch.object(orchestrator, "run_turn", AsyncMock(return_value=response)), patch.object(orchestrator, "_execute_server_tool", AsyncMock()) as execute:
            with self.assertRaises(HTTPException):
                await orchestrator.run_agent_turn(None, [], uuid.uuid4(), None, None, [], purpose="ifc_schedule")
            execute.assert_not_awaited()

    async def test_draft_does_not_replace_normal_poe_chat_history(self):
        from app.api import ai_chat
        user = SimpleNamespace(id=uuid.uuid4(), org_id=uuid.uuid4())
        db = AsyncMock()
        db.get.return_value = SimpleNamespace(created_by=user.id, org_id=user.org_id)
        result = orchestrator.AgentTurnResult(assistant_content=[], stop_reason="end_turn", messages=[])
        for purpose in ("chat", "ifc_schedule"):
            with patch.object(ai_chat, "run_agent_turn", AsyncMock(return_value=result)), patch.object(ai_chat.poe_conversation_svc, "save_messages", AsyncMock()) as save:
                await chat(AiChatRequest(project_id=uuid.uuid4(), messages=[], purpose=purpose), db, user)
                self.assertEqual(save.await_count, 2 if purpose == "chat" else 0)
