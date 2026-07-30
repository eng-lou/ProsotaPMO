from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.models.project import Project


async def _create_element(client: AsyncClient, project: Project, period: Period, description: str = "Piling") -> dict:
    resp = await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id), "period_id": str(period.id), "description": description,
    })
    assert resp.status_code == 201, resp.json()
    return resp.json()


async def test_create_rate_line_computes_total(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_element(client, project, live_period)
    resp = await client.post("/api/v1/cost-rate-lines/", json={
        "cost_element_id": el["id"], "description": "CFA piles to 8.5m", "qty": "267", "unit": "Nr", "rate": "576.00",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["description"] == "CFA piles to 8.5m"
    assert float(data["total"]) == 153792.00


async def test_list_rate_lines_oldest_first(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_element(client, project, live_period)
    await client.post("/api/v1/cost-rate-lines/", json={"cost_element_id": el["id"], "description": "Rig mobilisation", "qty": "1", "rate": "10000.00"})
    await client.post("/api/v1/cost-rate-lines/", json={"cost_element_id": el["id"], "description": "Test loading", "qty": "2", "rate": "4000.00"})

    resp = await client.get("/api/v1/cost-rate-lines/", params={"cost_element_id": el["id"]})
    assert resp.status_code == 200
    descriptions = [l["description"] for l in resp.json()]
    assert descriptions == ["Rig mobilisation", "Test loading"]


async def test_update_rate_line_recomputes_total(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_element(client, project, live_period)
    created = await client.post("/api/v1/cost-rate-lines/", json={
        "cost_element_id": el["id"], "description": "Cut off tops", "qty": "267", "rate": "100.00",
    })
    line_id = created.json()["id"]

    resp = await client.patch(f"/api/v1/cost-rate-lines/{line_id}", json={"qty": "300"})
    assert resp.status_code == 200
    assert float(resp.json()["total"]) == 30000.00


async def test_delete_rate_line(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_element(client, project, live_period)
    created = await client.post("/api/v1/cost-rate-lines/", json={
        "cost_element_id": el["id"], "description": "To be deleted", "qty": "1", "rate": "500.00",
    })
    line_id = created.json()["id"]

    assert (await client.delete(f"/api/v1/cost-rate-lines/{line_id}")).status_code == 204
    remaining = await client.get("/api/v1/cost-rate-lines/", params={"cost_element_id": el["id"]})
    assert remaining.json() == []


async def test_rate_line_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, frozen_period: Period
):
    from app.models.cost_element import CostElement
    frozen_element = CostElement(
        project_id=project.id, period_id=frozen_period.id, code="CST-9001", description="Frozen element",
    )
    db.add(frozen_element)
    await db.commit()
    await db.refresh(frozen_element)

    resp = await client.post("/api/v1/cost-rate-lines/", json={
        "cost_element_id": str(frozen_element.id), "description": "Should be rejected", "qty": "1", "rate": "100.00",
    })
    assert resp.status_code == 422


async def test_rate_line_for_unknown_element_404s(client: AsyncClient):
    resp = await client.post("/api/v1/cost-rate-lines/", json={
        "cost_element_id": str(uuid.uuid4()), "description": "Orphan line", "qty": "1", "rate": "100.00",
    })
    assert resp.status_code == 404


async def test_rate_line_persists_cost_code(client: AsyncClient, project: Project, live_period: Period):
    """cost_code (location/system/activity, 2026-07-27) round-trips like any
    other field — the BOQ tree (buildBoqTree, frontend) is built entirely
    from this string at read time, so it must actually persist."""
    el = await _create_element(client, project, live_period)
    created = await client.post("/api/v1/cost-rate-lines/", json={
        "cost_element_id": el["id"], "description": "L2 — Columns — Erect Steel Columns",
        "qty": "9", "rate": "866.67", "cost_code": "W-0004/COLUMNS/T-0114",
    })
    assert created.status_code == 201
    assert created.json()["cost_code"] == "W-0004/COLUMNS/T-0114"

    listed = await client.get("/api/v1/cost-rate-lines/", params={"cost_element_id": el["id"]})
    assert listed.json()[0]["cost_code"] == "W-0004/COLUMNS/T-0114"


async def test_rate_line_cost_code_null_by_default(client: AsyncClient, project: Project, live_period: Period):
    """A manually-added line (no source activity) has no cost code — must
    come back None, not an empty string or an error."""
    el = await _create_element(client, project, live_period)
    created = await client.post("/api/v1/cost-rate-lines/", json={
        "cost_element_id": el["id"], "description": "Manual line", "qty": "1", "rate": "500.00",
    })
    assert created.json()["cost_code"] is None
