from __future__ import annotations

from httpx import AsyncClient

from app.models.period import Period
from app.models.project import Project


def _payload(project_id: str, period_id: str, **overrides) -> dict:
    payload = {
        "project_id": project_id,
        "period_id": period_id,
        "elements": [
            {"element_type": "percentage", "rate": "0.12", "element_group": "On-Costs", "description": "Prelims"},
            {"element_type": "percentage", "rate": "0.08", "element_group": "On-Costs", "description": "Design Fees"},
        ],
    }
    payload.update(overrides)
    return payload


async def test_bulk_generate_creates_percentage_elements(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/cost-bulk-generate/", json=_payload(str(project.id), str(live_period.id)))
    assert resp.status_code == 201, resp.text
    assert resp.json()["element_count"] == 2

    elements = (await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id)})).json()
    descriptions = {e["description"] for e in elements}
    assert {"Prelims", "Design Fees"} <= descriptions
    prelims = next(e for e in elements if e["description"] == "Prelims")
    assert prelims["element_type"] == "percentage"
    assert float(prelims["rate"]) == 0.12
    assert prelims["source"] == "manual"


async def test_bulk_generate_dedupes_by_description(client: AsyncClient, project: Project, live_period: Period):
    first = await client.post("/api/v1/cost-bulk-generate/", json=_payload(str(project.id), str(live_period.id)))
    assert first.json()["element_count"] == 2

    second = await client.post("/api/v1/cost-bulk-generate/", json=_payload(str(project.id), str(live_period.id)))
    assert second.status_code == 201, second.text
    assert second.json()["element_count"] == 0

    elements = (await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id)})).json()
    assert sum(1 for e in elements if e["description"] == "Prelims") == 1


async def test_bulk_generate_dedupe_false_creates_duplicate(client: AsyncClient, project: Project, live_period: Period):
    payload = _payload(str(project.id), str(live_period.id), dedupe_by_description=False)
    first = await client.post("/api/v1/cost-bulk-generate/", json=payload)
    second = await client.post("/api/v1/cost-bulk-generate/", json=payload)
    assert first.json()["element_count"] == 2
    assert second.json()["element_count"] == 2

    elements = (await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id)})).json()
    assert sum(1 for e in elements if e["description"] == "Prelims") == 2


async def test_bulk_generate_rejects_frozen_period(client: AsyncClient, project: Project, frozen_period: Period):
    resp = await client.post("/api/v1/cost-bulk-generate/", json=_payload(str(project.id), str(frozen_period.id)))
    assert resp.status_code == 422


async def test_bulk_generate_empty_payload_is_a_noop(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post(
        "/api/v1/cost-bulk-generate/", json={"project_id": str(project.id), "period_id": str(live_period.id), "elements": []},
    )
    assert resp.status_code == 201
    assert resp.json()["element_count"] == 0
