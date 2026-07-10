from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod) -> str:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "schedule_period_id": str(period.id),
        "task_name": "Excavation works",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_create_with_suspend_and_resume(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "schedule_period_id": str(live_schedule_period.id),
        "task_name": "Excavation works",
        "suspend_date": "2026-07-10T09:00:00",
        "resume_date": "2026-07-15T09:00:00",
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["suspend_date"] is not None
    assert data["resume_date"] is not None


async def test_create_rejects_resume_before_suspend(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "schedule_period_id": str(live_schedule_period.id),
        "task_name": "Excavation works",
        "suspend_date": "2026-07-15T09:00:00",
        "resume_date": "2026-07-10T09:00:00",
    })
    assert resp.status_code == 422


async def test_update_sets_suspend_and_resume(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)

    resp = await client.patch(f"/api/v1/activities/{activity_id}", json={
        "suspend_date": "2026-07-10T09:00:00", "resume_date": "2026-07-15T09:00:00",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["suspend_date"] is not None
    assert resp.json()["resume_date"] is not None


async def test_update_rejects_resume_before_existing_suspend(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    await client.patch(f"/api/v1/activities/{activity_id}", json={"suspend_date": "2026-07-15T09:00:00"})

    resp = await client.patch(f"/api/v1/activities/{activity_id}", json={"resume_date": "2026-07-10T09:00:00"})
    assert resp.status_code == 422


async def test_update_clears_suspend_and_resume(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    await client.patch(f"/api/v1/activities/{activity_id}", json={
        "suspend_date": "2026-07-10T09:00:00", "resume_date": "2026-07-15T09:00:00",
    })

    resp = await client.patch(f"/api/v1/activities/{activity_id}", json={"suspend_date": None, "resume_date": None})
    assert resp.status_code == 200, resp.text
    assert resp.json()["suspend_date"] is None
    assert resp.json()["resume_date"] is None
