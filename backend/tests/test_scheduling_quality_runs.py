from __future__ import annotations

from httpx import AsyncClient

from app.models.schedule_period import SchedulePeriod
from app.models.project import Project


async def test_create_and_get_run_snapshots_current_report(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id), "task_name": "Solo",
    })

    create_resp = await client.post("/api/v1/scheduling-quality-runs/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Before cleanup",
    })
    assert create_resp.status_code == 201, create_resp.text
    run = create_resp.json()
    assert run["name"] == "Before cleanup"
    assert run["report"]["activity_count"] == 1

    get_resp = await client.get(f"/api/v1/scheduling-quality-runs/{run['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["report"]["activity_count"] == 1


async def test_list_returns_summary_with_counts(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    await client.post("/api/v1/scheduling-quality-runs/", json={"schedule_period_id": str(live_schedule_period.id), "name": "Snap A"})

    listing = (await client.get("/api/v1/scheduling-quality-runs/", params={"schedule_period_id": str(live_schedule_period.id)})).json()
    assert len(listing) == 1
    assert listing[0]["name"] == "Snap A"
    assert "failing_count" in listing[0]
    assert "warning_count" in listing[0]
    assert "report" not in listing[0]  # summary, not the full snapshot


async def test_delete_run(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    create_resp = await client.post("/api/v1/scheduling-quality-runs/", json={"schedule_period_id": str(live_schedule_period.id), "name": "Temp"})
    run_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/scheduling-quality-runs/{run_id}")
    assert del_resp.status_code == 204

    get_resp = await client.get(f"/api/v1/scheduling-quality-runs/{run_id}")
    assert get_resp.status_code == 404
