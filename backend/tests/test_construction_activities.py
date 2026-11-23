import uuid

from sqlalchemy import select

from app.models.activity import Activity


async def test_append_simulation_phases_under_existing_wbs(client, db, project, live_schedule_period):
    scope = {"project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id)}
    endpoint = "/api/v1/schedule-bulk-generate/"
    seed = await client.post(endpoint, json={**scope, "activities": [
        {"temp_id": "floor", "task_name": "Level 35"},
        {"temp_id": "old", "task_name": "Existing work", "parent_temp_id": "floor", "duration_hours": 4},
    ]})
    assert seed.status_code == 201, seed.text
    ids = seed.json()["activity_ids_by_temp_id"]
    tasks = [{"temp_id": "close", "task_name": "Close core forms", "duration_hours": 4,
              "category": "Core lift", "phase_key": "formwork_rebar"},
             {"temp_id": "pour", "task_name": "Pour core walls", "duration_hours": 6,
              "category": "Core lift", "phase_key": "pour"}]
    request = {**scope, "activities": tasks, "parent_wbs_id": ids["floor"]}
    for invalid in [ids["old"], str(uuid.uuid4())]:
        response = await client.post(endpoint, json={**request, "parent_wbs_id": invalid})
        assert response.status_code == 422, response.text
    response = await client.post(endpoint, json=request)
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["activity_count"] == 2
    assert result["resource_count"] == result["relationship_count"] == result["model_element_link_count"] == 0
    children = list(await db.scalars(select(Activity).where(
        Activity.parent_id == uuid.UUID(ids["floor"])).order_by(Activity.sort_order)))
    assert [t.task_name for t in children] == ["Existing work", "Close core forms", "Pour core walls"]
    assert children[-1].schedule_phase_key == "pour" and children[-1].start and children[-1].finish
