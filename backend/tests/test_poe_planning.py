import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from fastapi import HTTPException
from app.ai import planning_tools as planning
from app.api.ai_chat import approve_planning
from app.ai.tools import TOOLS, PROPOSAL_TOOL_NAMES


class PlanningTests(unittest.IsolatedAsyncioTestCase):
    def test_schema_has_no_unresolved_refs_or_privileged_fields(self):
        import json
        schema = json.dumps(planning.PLANNING_TOOLS)
        self.assertNotIn('"$ref"', schema)
        for entity in planning.REGISTRY:
            for action in ("create", "update"):
                if action == "create" and planning.REGISTRY[entity][1] is None: continue
                fields = planning.operation_schema(entity, action)["properties"]["data"]["properties"]
                self.assertFalse(set(fields) & planning.HIDDEN)
        self.assertIn("propose_planning_changes", PROPOSAL_TOOL_NAMES)
        self.assertEqual(sum(t["name"] == "propose_planning_changes" for t in TOOLS), 1)

    async def test_unapproved_operations_never_dispatched_by_agent(self):
        from app.ai import orchestrator
        from app.ai.openai_client import parse_response
        response = parse_response({"status": "completed", "output": [{"type": "function_call", "call_id": "c1", "name": "propose_planning_changes", "arguments": '{"operations": []}'}]})
        with patch.object(orchestrator, "run_turn", AsyncMock(return_value=response)), patch.object(orchestrator, "_execute_server_tool", AsyncMock()) as execute:
            result = await orchestrator.run_agent_turn(None, [], uuid.uuid4(), None, None, [])
        execute.assert_not_awaited()
        self.assertEqual(result.pending_proposals[0]["name"], "propose_planning_changes")

    async def test_unknown_or_privileged_changes_rejected_before_write(self):
        for entity, action, data in [("resource", "delete", {}), ("resource", "create", {"project_id": str(uuid.uuid4())}), ("schedule_settings", "update", {"freeze_status": "live"}), ("activity", "update", {"amend_relationships": True})]:
            db = AsyncMock()
            with self.assertRaises(HTTPException):
                await planning.apply_operation(db, planning.PlanningOperation(entity=entity, action=action, label="test", data=data), uuid.uuid4(), None, None)
            db.commit.assert_not_awaited()

    async def test_resource_creation_uses_existing_service_and_injects_project(self):
        project_id = uuid.uuid4()
        create = AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4()))
        old = planning.REGISTRY["resource"]
        with patch.dict(planning.REGISTRY, resource=(*old[:3], create, old[4])):
            result = await planning.apply_operation(AsyncMock(), planning.PlanningOperation(entity="resource", action="create", label="Groundworks crew", data={"name": "Groundworks crew", "resource_type": "crew", "unit": "day", "rate": 1920}), project_id, None, None)
        self.assertEqual(create.call_args.args[1].project_id, project_id)
        self.assertEqual(result["id"], str(create.return_value.id))

    async def test_hourly_label_cannot_silently_underprice_labour(self):
        create = AsyncMock()
        old = planning.REGISTRY["resource"]
        with patch.dict(planning.REGISTRY, resource=(*old[:3], create, old[4])):
            with self.assertRaises(HTTPException) as error:
                await planning.apply_operation(AsyncMock(), planning.PlanningOperation(entity="resource", action="create", label="labour", data={"name": "labour", "resource_type": "labour", "unit": "hour", "rate": 30}), uuid.uuid4(), None, None)
        self.assertIn("per working day", error.exception.detail)
        create.assert_not_awaited()

    async def test_frozen_schedule_cannot_be_reopened_or_edited(self):
        db = AsyncMock()
        db.execute.return_value = Mock(scalar_one_or_none=Mock(return_value=SimpleNamespace(freeze_status="frozen")))
        with self.assertRaises(HTTPException) as error:
            await planning.apply_operation(db, planning.PlanningOperation(entity="schedule_settings", action="update", record_id=uuid.uuid4(), label="date", data={"start_date": "2027-01-12"}), uuid.uuid4(), uuid.uuid4(), None)
        self.assertEqual(error.exception.status_code, 409)
        db.commit.assert_not_awaited()

    async def test_foreign_record_update_rejected(self):
        db = AsyncMock()
        db.execute.return_value = Mock(scalar_one_or_none=Mock(return_value=None))
        with self.assertRaises(HTTPException) as error:
            await planning.apply_operation(db, planning.PlanningOperation(entity="resource", action="update", record_id=uuid.uuid4(), label="rate", data={"rate": 15}), uuid.uuid4(), None, None)
        self.assertEqual(error.exception.status_code, 404)
        db.commit.assert_not_awaited()

    async def test_rate_update_resynchronises_linked_live_costs(self):
        db = AsyncMock()
        row = SimpleNamespace(resource_type="crew", unit="day")
        activity_id = uuid.uuid4()
        db.execute.side_effect = [Mock(scalar_one_or_none=Mock(return_value=row)),
                                  Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[activity_id, activity_id]))))]
        old = planning.REGISTRY["resource"]
        update = AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4()))
        with patch.dict(planning.REGISTRY, resource=(*old[:4], update)), patch("app.services.cost_sync.sync_cost_elements_from_resources_bulk", AsyncMock()) as sync:
            await planning.apply_operation(db, planning.PlanningOperation(entity="resource", action="update", record_id=uuid.uuid4(), label="daily rate", data={"rate": 2000}), uuid.uuid4(), None, None)
        sync.assert_awaited_once_with(db, [activity_id])
        db.refresh.assert_awaited_once_with(update.return_value)

    async def test_scoped_queries_filter_project_and_period(self):
        project, schedule, period = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        for entity in planning.REGISTRY:
            query = await planning.scoped_query(None, entity, project, schedule, period)
            values = query.compile().params.values()
            self.assertIn(project, values)
            if entity in ("activity", "schedule_settings"): self.assertIn(schedule, values)
            if entity == "cost_element": self.assertIn(period, values)

    async def test_foreign_project_cannot_approve(self):
        db = AsyncMock()
        db.get.return_value = SimpleNamespace(org_id=uuid.uuid4(), created_by=uuid.uuid4())
        with self.assertRaises(HTTPException) as error:
            await approve_planning(planning.PlanningApproval(project_id=uuid.uuid4(), operations=[]), db, SimpleNamespace(org_id=uuid.uuid4(), id=uuid.uuid4()))
        self.assertEqual(error.exception.status_code, 404)

    async def test_partial_failure_returns_saved_ids_and_error_without_repeating(self):
        user = SimpleNamespace(org_id=uuid.uuid4(), id=uuid.uuid4())
        db = AsyncMock()
        db.get.return_value = SimpleNamespace(org_id=user.org_id, created_by=user.id)
        op = planning.PlanningOperation(entity="resource", action="create", label="crew", data={"name": "crew"})
        with patch("app.api.ai_chat.apply_operation", AsyncMock(side_effect=[{"id": "saved"}, HTTPException(422, "Invalid rate")])) as apply:
            result = await approve_planning(planning.PlanningApproval(project_id=uuid.uuid4(), operations=[op, op]), db, user)
        self.assertEqual(apply.await_count, 2)
        self.assertTrue(result["results"][0]["ok"])
        self.assertFalse(result["results"][1]["ok"])
        db.rollback.assert_awaited_once()

if __name__ == "__main__": unittest.main()
