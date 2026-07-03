from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project


async def test_list_seeds_defaults(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/scheduling-quality-criteria/", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 11
    assert {r["check_number"] for r in rows} == set(range(1, 12))
    check1 = next(r for r in rows if r["check_number"] == 1)
    assert float(check1["threshold"]) == 5.0


async def test_update_criterion_changes_live_report(client: AsyncClient, project: Project, live_period):
    rows = (await client.get("/api/v1/scheduling-quality-criteria/", params={"project_id": str(project.id)})).json()
    check1_id = next(r["id"] for r in rows if r["check_number"] == 1)

    update_resp = await client.patch(f"/api/v1/scheduling-quality-criteria/{check1_id}", json={"threshold": 50})
    assert update_resp.status_code == 200, update_resp.text
    assert float(update_resp.json()["threshold"]) == 50.0

    # Create one unlinked activity (100% missing predecessors) — with the
    # threshold raised to 50%, DCMA #1 should now warn instead of fail
    # (>threshold but <=2x threshold).
    await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Solo",
    })
    report = (await client.get("/api/v1/scheduling-quality/", params={"period_id": str(live_period.id)})).json()
    check1 = next(c for c in report["checks"] if c["number"] == 1)
    assert check1["threshold_label"] == "<50%"
    assert check1["status"] == "warn"


async def test_reset_restores_defaults(client: AsyncClient, project: Project):
    rows = (await client.get("/api/v1/scheduling-quality-criteria/", params={"project_id": str(project.id)})).json()
    check1_id = next(r["id"] for r in rows if r["check_number"] == 1)
    await client.patch(f"/api/v1/scheduling-quality-criteria/{check1_id}", json={"threshold": 99})

    reset_resp = await client.post("/api/v1/scheduling-quality-criteria/reset", params={"project_id": str(project.id)})
    assert reset_resp.status_code == 200, reset_resp.text
    reset_rows = reset_resp.json()
    check1_after = next(r for r in reset_rows if r["check_number"] == 1)
    assert float(check1_after["threshold"]) == 5.0
