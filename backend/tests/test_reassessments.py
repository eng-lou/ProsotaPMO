from __future__ import annotations

import uuid
from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.models.project import Project


async def _create_risk(client: AsyncClient, project: Project, period: Period) -> dict:
    resp = await client.post("/api/v1/risks/", json={
        "project_id": str(project.id), "period_id": str(period.id), "title": "Supply chain delay",
    })
    assert resp.status_code == 201, resp.json()
    return resp.json()


async def _create_icd_item(client: AsyncClient, project: Project, period: Period) -> dict:
    resp = await client.post("/api/v1/icd-items/", json={
        "project_id": str(project.id), "period_id": str(period.id),
        "item_type": "issue", "title": "Underground service clash", "severity": "high",
    })
    assert resp.status_code == 201, resp.json()
    return resp.json()


async def _create_cost_element(client: AsyncClient, project: Project, period: Period) -> dict:
    resp = await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id), "period_id": str(period.id), "description": "Piling", "budget": "354451.00",
    })
    assert resp.status_code == 201, resp.json()
    return resp.json()


# ---------------------------------------------------------------------------
# One generalised endpoint, exercised against all three record types — this
# is the whole point of Phase 7: the same log mechanism now backs Risk, ICD,
# and Cost Plan instead of three near-identical copies.
# ---------------------------------------------------------------------------

async def test_create_reassessment_for_risk(client: AsyncClient, project: Project, live_period: Period):
    risk = await _create_risk(client, project, live_period)
    resp = await client.post("/api/v1/reassessments/", json={
        "record_type": "risk", "record_id": risk["id"],
        "note": "Probability revised from 0.65 to 0.30 following supplier confirmation of dual-sourcing.",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["record_type"] == "risk"
    assert data["record_id"] == risk["id"]
    assert "Probability revised" in data["note"]


async def test_create_reassessment_for_icd_item(client: AsyncClient, project: Project, live_period: Period):
    item = await _create_icd_item(client, project, live_period)
    resp = await client.post("/api/v1/reassessments/", json={
        "record_type": "icd_item", "record_id": item["id"], "note": "Severity escalated to high.",
    })
    assert resp.status_code == 201
    assert resp.json()["record_type"] == "icd_item"


async def test_create_reassessment_for_cost_element(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_cost_element(client, project, live_period)
    resp = await client.post("/api/v1/reassessments/", json={
        "record_type": "cost_element", "record_id": el["id"], "note": "Re-forecast following tender return.",
    })
    assert resp.status_code == 201
    assert resp.json()["record_type"] == "cost_element"


async def test_create_reassessment_bumps_parent_last_reviewed_date(
    client: AsyncClient, project: Project, live_period: Period
):
    """Logging a reassessment is itself a review event — auto-updates the
    parent's last_reviewed_date, whichever of the three record types it is."""
    el = await _create_cost_element(client, project, live_period)
    assert el["last_reviewed_date"] is None

    await client.post("/api/v1/reassessments/", json={
        "record_type": "cost_element", "record_id": el["id"], "note": "Reviewed at monthly cost meeting.",
    })

    updated = await client.get(f"/api/v1/cost-elements/{el['id']}")
    assert updated.json()["last_reviewed_date"] == date.today().isoformat()


async def test_list_reassessments_scoped_by_record_type_and_id(
    client: AsyncClient, project: Project, live_period: Period
):
    """Two different record types must not leak into each other's log, even if
    record_id happened to collide (they won't in practice, but record_type
    must still be part of the query, not just record_id)."""
    risk = await _create_risk(client, project, live_period)
    item = await _create_icd_item(client, project, live_period)
    await client.post("/api/v1/reassessments/", json={"record_type": "risk", "record_id": risk["id"], "note": "Risk note"})
    await client.post("/api/v1/reassessments/", json={"record_type": "icd_item", "record_id": item["id"], "note": "ICD note"})

    risk_log = (await client.get("/api/v1/reassessments/", params={"record_type": "risk", "record_id": risk["id"]})).json()
    assert len(risk_log) == 1
    assert risk_log[0]["note"] == "Risk note"

    icd_log = (await client.get("/api/v1/reassessments/", params={"record_type": "icd_item", "record_id": item["id"]})).json()
    assert len(icd_log) == 1
    assert icd_log[0]["note"] == "ICD note"


async def test_list_reassessments_newest_first(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_cost_element(client, project, live_period)
    await client.post("/api/v1/reassessments/", json={"record_type": "cost_element", "record_id": el["id"], "note": "First review"})
    await client.post("/api/v1/reassessments/", json={"record_type": "cost_element", "record_id": el["id"], "note": "Second review"})

    resp = await client.get("/api/v1/reassessments/", params={"record_type": "cost_element", "record_id": el["id"]})
    assert resp.status_code == 200
    notes = [r["note"] for r in resp.json()]
    assert notes == ["Second review", "First review"]


async def test_reassessment_rejects_unknown_record_type(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/reassessments/", json={
        "record_type": "widget", "record_id": str(uuid.uuid4()), "note": "Should be rejected",
    })
    assert resp.status_code == 422


async def test_reassessment_for_unknown_record_404s(client: AsyncClient):
    resp = await client.post("/api/v1/reassessments/", json={
        "record_type": "risk", "record_id": str(uuid.uuid4()), "note": "Orphan note",
    })
    assert resp.status_code == 404


async def test_reassessment_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, frozen_period: Period
):
    from app.models.risk import Risk
    frozen_risk = Risk(project_id=project.id, period_id=frozen_period.id, code="RSK-9010", title="Frozen risk")
    db.add(frozen_risk)
    await db.commit()
    await db.refresh(frozen_risk)

    resp = await client.post("/api/v1/reassessments/", json={
        "record_type": "risk", "record_id": str(frozen_risk.id), "note": "Should be rejected",
    })
    assert resp.status_code == 422


async def test_update_reassessment_note(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_cost_element(client, project, live_period)
    created = await client.post("/api/v1/reassessments/", json={
        "record_type": "cost_element", "record_id": el["id"], "note": "Original wording",
    })
    entry_id = created.json()["id"]

    resp = await client.patch(f"/api/v1/reassessments/{entry_id}", json={"note": "Corrected wording"})
    assert resp.status_code == 200
    assert resp.json()["note"] == "Corrected wording"


async def test_delete_reassessment(client: AsyncClient, project: Project, live_period: Period):
    el = await _create_cost_element(client, project, live_period)
    created = await client.post("/api/v1/reassessments/", json={
        "record_type": "cost_element", "record_id": el["id"], "note": "To be deleted",
    })
    entry_id = created.json()["id"]

    assert (await client.delete(f"/api/v1/reassessments/{entry_id}")).status_code == 204
    remaining = await client.get("/api/v1/reassessments/", params={"record_type": "cost_element", "record_id": el["id"]})
    assert remaining.json() == []
