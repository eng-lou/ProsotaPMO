from __future__ import annotations

from httpx import AsyncClient

from app.models.period import Period
from app.models.project import Project


async def _create_risk(client: AsyncClient, project: Project, period: Period, title: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "title": title}
    payload.update(overrides)
    resp = await client.post("/api/v1/risks/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_baseline_snapshots_every_risk(client: AsyncClient, project: Project, live_period: Period):
    r1 = await _create_risk(client, project, live_period, "Weather delay", probability="0.4", impact="0.3", cost_most_likely="50000")
    await _create_risk(client, project, live_period, "Design change")

    resp = await client.post("/api/v1/risk-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })
    assert resp.status_code == 201, resp.text
    baseline = resp.json()
    assert baseline["item_count"] == 2
    assert baseline["baseline_set_id"] is None

    snapshot = (await client.get(f"/api/v1/risk-baselines/{baseline['id']}/snapshot")).json()
    weather = next(s for s in snapshot if s["risk_id"] == r1["id"])
    assert weather["rating"] == "0.12"
    assert weather["emv_cost"] == "-20000.00"  # threat: -1 * 0.4 * 50000


async def test_snapshot_stays_frozen_after_risk_changes(client: AsyncClient, project: Project, live_period: Period):
    r = await _create_risk(client, project, live_period, "Weather delay", probability="0.4", impact="0.3")
    baseline = (await client.post("/api/v1/risk-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()

    await client.patch(f"/api/v1/risks/{r['id']}", json={"probability": "0.9"})

    snapshot = (await client.get(f"/api/v1/risk-baselines/{baseline['id']}/snapshot")).json()
    assert snapshot[0]["rating"] == "0.12"  # unchanged — frozen at capture time

    live = (await client.get(f"/api/v1/risks/{r['id']}")).json()
    assert live["rating"] == "0.27"  # live value has moved on


async def test_list_baselines_ordered_newest_first(client: AsyncClient, project: Project, live_period: Period):
    await client.post("/api/v1/risk-baselines/", json={"period_id": str(live_period.id), "name": "Early", "baseline_date": "2026-01-01"})
    await client.post("/api/v1/risk-baselines/", json={"period_id": str(live_period.id), "name": "Late", "baseline_date": "2026-06-01"})

    listing = (await client.get("/api/v1/risk-baselines/", params={"period_id": str(live_period.id)})).json()
    assert [b["name"] for b in listing] == ["Late", "Early"]


async def test_delete_baseline_removes_its_items(client: AsyncClient, project: Project, live_period: Period):
    await _create_risk(client, project, live_period, "Weather delay")
    baseline = (await client.post("/api/v1/risk-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()

    resp = await client.delete(f"/api/v1/risk-baselines/{baseline['id']}")
    assert resp.status_code == 204
    assert (await client.get(f"/api/v1/risk-baselines/{baseline['id']}/snapshot")).status_code == 404


async def test_create_baseline_rejects_frozen_period(client: AsyncClient, project: Project, frozen_period: Period):
    resp = await client.post("/api/v1/risk-baselines/", json={
        "period_id": str(frozen_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })
    assert resp.status_code == 422
