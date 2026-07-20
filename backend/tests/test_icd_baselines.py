from __future__ import annotations

from httpx import AsyncClient

from app.models.period import Period
from app.models.project import Project


async def _create_icd_item(client: AsyncClient, project: Project, period: Period, item_type: str, title: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "item_type": item_type, "title": title}
    payload.update(overrides)
    resp = await client.post("/api/v1/icd-items/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_baseline_snapshots_every_item(client: AsyncClient, project: Project, live_period: Period):
    issue = await _create_icd_item(client, project, live_period, "issue", "Site access blocked")
    await _create_icd_item(client, project, live_period, "change", "Extra glazing")

    baseline = (await client.post("/api/v1/icd-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()
    assert baseline["item_count"] == 2

    snapshot = (await client.get(f"/api/v1/icd-baselines/{baseline['id']}/snapshot")).json()
    issue_item = next(s for s in snapshot if s["icd_item_id"] == issue["id"])
    assert issue_item["item_type"] == "issue"
    assert issue_item["status"] == "open"


async def test_snapshot_stays_frozen_after_status_changes(client: AsyncClient, project: Project, live_period: Period):
    issue = await _create_icd_item(client, project, live_period, "issue", "Site access blocked")
    baseline = (await client.post("/api/v1/icd-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()

    await client.patch(f"/api/v1/icd-items/{issue['id']}", json={"status": "closed"})

    snapshot = (await client.get(f"/api/v1/icd-baselines/{baseline['id']}/snapshot")).json()
    assert snapshot[0]["status"] == "open"  # frozen at capture time

    live = (await client.get(f"/api/v1/icd-items/{issue['id']}")).json()
    assert live["status"] == "closed"
