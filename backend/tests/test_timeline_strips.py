from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, name: str = "Substructure") -> str:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": name,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _create_strip(client: AsyncClient, project: Project, **fields) -> dict:
    resp = await client.post("/api/v1/timeline-strips/", json={"project_id": str(project.id), **fields})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_list_is_empty_when_nothing_created(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/timeline-strips/", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


async def test_create_uses_defaults(client: AsyncClient, project: Project):
    strip = await _create_strip(client, project)
    assert strip["id"] is not None
    assert strip["title"] == "Timeline Strip"
    assert strip["visible"] is True
    assert strip["position_x_pct"] == 10.0
    assert strip["position_y_pct"] == 90.0
    assert strip["width_px"] == 900.0
    assert strip["height_px"] == 56.0
    assert strip["font_size"] == 11.0
    assert strip["scope_mode"] == "all"
    assert strip["viewport_slot"] is None


async def test_a_project_can_hold_several_strips_one_per_view(client: AsyncClient, project: Project):
    main = await _create_strip(client, project, title="Whole project")
    footing = await _create_strip(client, project, title="Footing", viewport_slot=0)
    second = await _create_strip(client, project, title="Second floor", viewport_slot=2)

    listing = (await client.get("/api/v1/timeline-strips/", params={"project_id": str(project.id)})).json()
    assert [s["id"] for s in listing] == [main["id"], footing["id"], second["id"]]
    assert [s["viewport_slot"] for s in listing] == [None, 0, 2]


async def test_patch_updates_only_sent_fields_and_can_move_back_to_main(client: AsyncClient, project: Project):
    strip = await _create_strip(client, project, width_px=1200.0, viewport_slot=1)

    resp = await client.patch(f"/api/v1/timeline-strips/{strip['id']}", json={"position_x_pct": 35.0})
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["position_x_pct"] == 35.0
    assert updated["width_px"] == 1200.0
    assert updated["viewport_slot"] == 1

    back = await client.patch(f"/api/v1/timeline-strips/{strip['id']}", json={"viewport_slot": None})
    assert back.status_code == 200, back.text
    assert back.json()["viewport_slot"] is None


async def test_delete_removes_only_that_strip(client: AsyncClient, project: Project):
    keep = await _create_strip(client, project)
    drop = await _create_strip(client, project)
    resp = await client.delete(f"/api/v1/timeline-strips/{drop['id']}")
    assert resp.status_code == 204
    listing = (await client.get("/api/v1/timeline-strips/", params={"project_id": str(project.id)})).json()
    assert [s["id"] for s in listing] == [keep["id"]]

    missing = await client.delete(f"/api/v1/timeline-strips/{drop['id']}")
    assert missing.status_code == 404


async def test_validation(client: AsyncClient, project: Project):
    for bad in ({"width_px": 0}, {"height_px": 0}, {"position_x_pct": 101}, {"font_size": 0}, {"viewport_slot": 3}, {"viewport_slot": -1}):
        resp = await client.post("/api/v1/timeline-strips/", json={"project_id": str(project.id), **bad})
        assert resp.status_code == 422, bad


async def test_wbs_scope_round_trips(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    strip = await _create_strip(client, project)

    resp = await client.patch(f"/api/v1/timeline-strips/{strip['id']}", json={
        "scope_mode": "wbs", "wbs_node_activity_id": activity_id,
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["scope_mode"] == "wbs"
    assert updated["wbs_node_activity_id"] == activity_id
