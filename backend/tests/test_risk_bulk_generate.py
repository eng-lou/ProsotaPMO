from __future__ import annotations

from httpx import AsyncClient

from app.models.period import Period
from app.models.project import Project


def _payload(project_id: str, period_id: str, **overrides) -> dict:
    payload = {
        "project_id": project_id,
        "period_id": period_id,
        "risks": [
            {
                "title": "Material Price Escalation", "category": "Cost", "area": "Market",
                "risk_type": "threat", "probability": "0.35", "impact": "0.5",
                "cost_most_likely": "20000", "cause": "Volatile material markets",
                "effect": "Budget overrun", "rationale": "Long procurement lead times",
            },
            {
                "title": "Adverse Weather Delays Site Works", "category": "Schedule", "area": "Site",
                "risk_type": "threat", "probability": "0.4", "impact": "0.3",
                "schedule_most_likely_days": 10,
            },
        ],
    }
    payload.update(overrides)
    return payload


async def test_bulk_generate_creates_risks_with_computed_fields(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/risk-bulk-generate/", json=_payload(str(project.id), str(live_period.id)))
    assert resp.status_code == 201, resp.text
    assert resp.json()["risk_count"] == 2

    risks = (await client.get("/api/v1/risks/", params={"project_id": str(project.id)})).json()
    escalation = next(r for r in risks if r["title"] == "Material Price Escalation")
    # rating is Numeric(5,2) — 0.35 x 0.5 = 0.175, DB-rounded (half-up) to
    # 0.18; Python's own round() would give 0.17 here (binary float 0.175 is
    # actually a hair under 0.175), so the expected value is hardcoded
    # rather than computed the same way, to avoid the two disagreeing.
    assert float(escalation["rating"]) == 0.18
    # threat -> negative emv_cost (erodes budget), per risk.py's own sign convention
    assert float(escalation["emv_cost"]) == -(0.35 * 20000)

    weather = next(r for r in risks if r["title"] == "Adverse Weather Delays Site Works")
    assert float(weather["emv_schedule_days"]) == 0.4 * 10


async def test_bulk_generate_dedupes_by_title(client: AsyncClient, project: Project, live_period: Period):
    payload = _payload(str(project.id), str(live_period.id), sync_contingency=False)
    first = await client.post("/api/v1/risk-bulk-generate/", json=payload)
    assert first.json()["risk_count"] == 2
    second = await client.post("/api/v1/risk-bulk-generate/", json=payload)
    assert second.json()["risk_count"] == 0

    risks = (await client.get("/api/v1/risks/", params={"project_id": str(project.id)})).json()
    assert sum(1 for r in risks if r["title"] == "Material Price Escalation") == 1


async def test_bulk_generate_syncs_contingency_from_emv(client: AsyncClient, project: Project, live_period: Period):
    # A real fixed-cost baseline first (mirrors cost_sync.py's own
    # resource-loaded "fixed" elements) — the contingency % is meaningless
    # without one, per the service's own skip-if-zero-baseline rule.
    await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "description": "Structure", "element_type": "fixed", "budget": "100000",
    })

    resp = await client.post("/api/v1/risk-bulk-generate/", json=_payload(str(project.id), str(live_period.id)))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    # Only "Material Price Escalation" has a cost EMV (20000 x 0.35 = 7000);
    # the weather risk only carries a schedule impact.
    assert float(body["total_emv_cost"]) == 0.35 * 20000
    assert body["contingency_cost_element_id"] is not None
    expected_rate = round((0.35 * 20000) / 100000, 6)
    assert round(float(body["contingency_rate"]), 6) == expected_rate

    elements = (await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id)})).json()
    contingency = next(e for e in elements if e["description"] == "Contingency (Risk-Derived)")
    assert contingency["element_type"] == "percentage"
    assert round(float(contingency["rate"]), 6) == expected_rate


async def test_bulk_generate_skips_contingency_with_no_fixed_baseline(client: AsyncClient, project: Project, live_period: Period):
    # No cost elements created at all this time — nothing to base a % on.
    resp = await client.post("/api/v1/risk-bulk-generate/", json=_payload(str(project.id), str(live_period.id)))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["contingency_cost_element_id"] is None
    assert body["contingency_rate"] is None

    elements = (await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id)})).json()
    assert not any(e["description"] == "Contingency (Risk-Derived)" for e in elements)


async def test_bulk_generate_contingency_refreshes_on_rerun(client: AsyncClient, project: Project, live_period: Period):
    await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "description": "Structure", "element_type": "fixed", "budget": "100000",
    })
    first = await client.post("/api/v1/risk-bulk-generate/", json=_payload(str(project.id), str(live_period.id)))
    first_contingency_id = first.json()["contingency_cost_element_id"]

    # A second, different risk added on a re-run should refresh the SAME
    # contingency row (not create a second one) with the new, larger total.
    payload = _payload(str(project.id), str(live_period.id))
    payload["risks"] = [{
        "title": "Design Change Risk", "category": "Schedule", "area": "Design",
        "risk_type": "threat", "probability": "0.5", "impact": "0.4", "cost_most_likely": "10000",
    }]
    second = await client.post("/api/v1/risk-bulk-generate/", json=payload)
    assert second.json()["risk_count"] == 1
    assert second.json()["contingency_cost_element_id"] == first_contingency_id

    elements = (await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id)})).json()
    contingencies = [e for e in elements if e["description"] == "Contingency (Risk-Derived)"]
    assert len(contingencies) == 1
    expected_rate = round((0.5 * 10000) / 100000, 6)
    assert round(float(contingencies[0]["rate"]), 6) == expected_rate


async def test_bulk_generate_rejects_frozen_period(client: AsyncClient, project: Project, frozen_period: Period):
    resp = await client.post("/api/v1/risk-bulk-generate/", json=_payload(str(project.id), str(frozen_period.id)))
    assert resp.status_code == 422
