from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, name: str = "Excavation works") -> str:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "schedule_period_id": str(period.id),
        "task_name": name,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_create_and_list_steps(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)

    resp = await client.post("/api/v1/activity-steps/", json={"activity_id": activity_id, "name": "Set out"})
    assert resp.status_code == 201, resp.text
    step = resp.json()
    assert step["name"] == "Set out"
    assert step["is_complete"] is False
    assert step["sort_order"] == 0

    await client.post("/api/v1/activity-steps/", json={"activity_id": activity_id, "name": "Dig"})

    listing = (await client.get("/api/v1/activity-steps/", params={"activity_id": activity_id})).json()
    assert [s["name"] for s in listing] == ["Set out", "Dig"]
    assert [s["sort_order"] for s in listing] == [0, 1]


async def test_update_step_name_and_complete(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    create_resp = await client.post("/api/v1/activity-steps/", json={"activity_id": activity_id, "name": "Set out"})
    step_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/v1/activity-steps/{step_id}", json={"is_complete": True})
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_complete"] is True
    assert resp.json()["name"] == "Set out"

    resp = await client.patch(f"/api/v1/activity-steps/{step_id}", json={"name": "Set out & survey"})
    assert resp.json()["name"] == "Set out & survey"
    assert resp.json()["is_complete"] is True


async def test_delete_step(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    create_resp = await client.post("/api/v1/activity-steps/", json={"activity_id": activity_id, "name": "Set out"})
    step_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/activity-steps/{step_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/activity-steps/", params={"activity_id": activity_id})).json()
    assert listing == []


async def test_deleting_activity_cascades_its_steps(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    await client.post("/api/v1/activity-steps/", json={"activity_id": activity_id, "name": "Set out"})

    await client.delete(f"/api/v1/activities/{activity_id}", params={"cascade": True})

    # Steps are gone too — no orphaned rows once the parent activity is archived/deleted.
    listing = (await client.get("/api/v1/activity-steps/", params={"activity_id": activity_id})).json()
    assert listing == []


async def test_move_step_up_and_down(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    ids = []
    for name in ["Set out", "Dig", "Pour"]:
        resp = await client.post("/api/v1/activity-steps/", json={"activity_id": activity_id, "name": name})
        ids.append(resp.json()["id"])

    # Move "Dig" (index 1) up — swaps with "Set out".
    resp = await client.post(f"/api/v1/activity-steps/{ids[1]}/move", json={"direction": "up"})
    assert resp.status_code == 200, resp.text

    listing = (await client.get("/api/v1/activity-steps/", params={"activity_id": activity_id})).json()
    assert [s["name"] for s in listing] == ["Dig", "Set out", "Pour"]

    # Moving the first step up again is a no-op, not an error.
    resp = await client.post(f"/api/v1/activity-steps/{ids[1]}/move", json={"direction": "up"})
    assert resp.status_code == 200
    listing = (await client.get("/api/v1/activity-steps/", params={"activity_id": activity_id})).json()
    assert [s["name"] for s in listing] == ["Dig", "Set out", "Pour"]

    # Moving the last step down is also a no-op.
    resp = await client.post(f"/api/v1/activity-steps/{ids[2]}/move", json={"direction": "down"})
    assert resp.status_code == 200
    listing = (await client.get("/api/v1/activity-steps/", params={"activity_id": activity_id})).json()
    assert [s["name"] for s in listing] == ["Dig", "Set out", "Pour"]


async def test_update_missing_step_404s(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    resp = await client.patch("/api/v1/activity-steps/00000000-0000-0000-0000-000000000000", json={"name": "x"})
    assert resp.status_code == 404


async def test_steps_scoped_per_activity(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_a = await _create_activity(client, project, live_schedule_period, "Activity A")
    activity_b = await _create_activity(client, project, live_schedule_period, "Activity B")
    await client.post("/api/v1/activity-steps/", json={"activity_id": activity_a, "name": "A step"})
    await client.post("/api/v1/activity-steps/", json={"activity_id": activity_b, "name": "B step"})

    listing_a = (await client.get("/api/v1/activity-steps/", params={"activity_id": activity_a})).json()
    assert [s["name"] for s in listing_a] == ["A step"]
