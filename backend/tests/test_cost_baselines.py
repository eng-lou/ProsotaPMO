from __future__ import annotations

from httpx import AsyncClient

from app.models.period import Period
from app.models.project import Project


async def _create_cost_element(client: AsyncClient, project: Project, period: Period, description: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "description": description}
    payload.update(overrides)
    resp = await client.post("/api/v1/cost-elements/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_baseline_resolves_percentage_elements(client: AsyncClient, project: Project, live_period: Period):
    fixed = await _create_cost_element(client, project, live_period, "Substructure", budget="100000", actuals="40000", pct_complete=50)
    pct = await _create_cost_element(client, project, live_period, "Prelims", element_type="percentage", rate="0.10", pct_complete=50)

    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()
    assert baseline["item_count"] == 2

    snapshot = (await client.get(f"/api/v1/cost-baselines/{baseline['id']}/snapshot")).json()
    fixed_item = next(s for s in snapshot if s["cost_element_id"] == fixed["id"])
    pct_item = next(s for s in snapshot if s["cost_element_id"] == pct["id"])
    assert fixed_item["bac"] == "100000.00" and fixed_item["ac"] == "40000.00"
    # 10% of the fixed subtotal (100,000) -> resolved computed_budget/computed_actuals.
    assert pct_item["bac"] == "10000.00" and pct_item["ac"] == "4000.00"


async def test_element_with_no_budget_is_skipped(client: AsyncClient, project: Project, live_period: Period):
    await _create_cost_element(client, project, live_period, "TBC line")  # no budget set

    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()
    assert baseline["item_count"] == 0


async def test_delete_baseline(client: AsyncClient, project: Project, live_period: Period):
    await _create_cost_element(client, project, live_period, "Substructure", budget="100000")
    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()

    assert (await client.delete(f"/api/v1/cost-baselines/{baseline['id']}")).status_code == 204
    assert (await client.get(f"/api/v1/cost-baselines/{baseline['id']}/snapshot")).status_code == 404
