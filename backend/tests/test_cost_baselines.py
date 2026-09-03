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


# ---------------------------------------------------------------------------
# Assign/unassign (2026-09-03, per Maro's domain correction — "the baseline of
# the figures becomes the approved budget... we can create multiple baselines
# and choose to assign a particular baseline as the budget figures to measure
# against"). Mirrors schedule_baselines' own assign/unassign test coverage.
# ---------------------------------------------------------------------------

async def test_assign_baseline_sets_bl_budget(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_cost_element(client, project, live_period, "Substructure", budget="100000")
    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()

    resp = await client.post(f"/api/v1/cost-baselines/{baseline['id']}/assign")
    assert resp.status_code == 200
    updated = next(e for e in resp.json() if e["id"] == el["id"])
    assert float(updated["bl_budget"]) == 100000.00

    listed = (await client.get("/api/v1/cost-baselines/", params={"period_id": str(live_period.id)})).json()
    assert listed[0]["is_active"] is True


async def test_only_one_baseline_active_per_period(client: AsyncClient, project: Project, live_period: Period):
    await _create_cost_element(client, project, live_period, "Substructure", budget="100000")
    baseline_a = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "A", "baseline_date": "2026-07-20",
    })).json()
    baseline_b = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "B", "baseline_date": "2026-07-21",
    })).json()

    await client.post(f"/api/v1/cost-baselines/{baseline_a['id']}/assign")
    await client.post(f"/api/v1/cost-baselines/{baseline_b['id']}/assign")

    listed = {b["id"]: b for b in (await client.get("/api/v1/cost-baselines/", params={"period_id": str(live_period.id)})).json()}
    assert listed[baseline_a["id"]]["is_active"] is False
    assert listed[baseline_b["id"]]["is_active"] is True


async def test_unassign_baseline(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_cost_element(client, project, live_period, "Substructure", budget="100000")
    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()
    await client.post(f"/api/v1/cost-baselines/{baseline['id']}/assign")

    resp = await client.post(f"/api/v1/cost-baselines/{baseline['id']}/unassign")
    assert resp.status_code == 200
    updated = next(e for e in resp.json() if e["id"] == el["id"])
    assert updated["bl_budget"] is None

    listed = (await client.get("/api/v1/cost-baselines/", params={"period_id": str(live_period.id)})).json()
    assert listed[0]["is_active"] is False


async def test_unassign_baseline_that_is_not_assigned_rejected(client: AsyncClient, project: Project, live_period: Period):
    await _create_cost_element(client, project, live_period, "Substructure", budget="100000")
    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()
    resp = await client.post(f"/api/v1/cost-baselines/{baseline['id']}/unassign")
    assert resp.status_code == 422


async def test_delete_active_baseline_clears_bl_budget(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_cost_element(client, project, live_period, "Substructure", budget="100000")
    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-07-20",
    })).json()
    await client.post(f"/api/v1/cost-baselines/{baseline['id']}/assign")

    assert (await client.delete(f"/api/v1/cost-baselines/{baseline['id']}")).status_code == 204
    resp = await client.get(f"/api/v1/cost-elements/{el['id']}")
    assert resp.json()["bl_budget"] is None
