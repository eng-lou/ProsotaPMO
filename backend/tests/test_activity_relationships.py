from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.models.project import Project


async def _create_activity(client: AsyncClient, project: Project, period: Period, task_name: str) -> dict:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(period.id),
        "task_name": task_name,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_relationship(client: AsyncClient, project: Project, live_period: Period):
    a = await _create_activity(client, project, live_period, "Excavation")
    b = await _create_activity(client, project, live_period, "Piling")

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"],
        "successor_id": b["id"],
        "relationship_type": "FS",
        "lag_days": 2,
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["relationship_type"] == "FS"
    assert data["lag_days"] == 2


async def test_relationship_defaults_to_fs_zero_lag(
    client: AsyncClient, project: Project, live_period: Period
):
    a = await _create_activity(client, project, live_period, "Excavation")
    b = await _create_activity(client, project, live_period, "Piling")

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["relationship_type"] == "FS"
    assert data["lag_days"] == 0


async def test_self_relationship_rejected(client: AsyncClient, project: Project, live_period: Period):
    a = await _create_activity(client, project, live_period, "Excavation")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": a["id"],
    })
    assert resp.status_code == 422


async def test_duplicate_pair_rejected(client: AsyncClient, project: Project, live_period: Period):
    a = await _create_activity(client, project, live_period, "Excavation")
    b = await _create_activity(client, project, live_period, "Piling")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    assert resp.status_code == 201

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"], "relationship_type": "SS",
    })
    assert resp.status_code == 422


async def test_reverse_relationship_rejected(client: AsyncClient, project: Project, live_period: Period):
    a = await _create_activity(client, project, live_period, "Excavation")
    b = await _create_activity(client, project, live_period, "Piling")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    assert resp.status_code == 201

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": b["id"], "successor_id": a["id"],
    })
    assert resp.status_code == 422
    assert "reverse" in resp.json()["detail"].lower()


async def test_cross_period_relationship_rejected(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    other_period = Period(project_id=project.id, period_label="Period 2", freeze_status="live")
    db.add(other_period)
    await db.commit()
    await db.refresh(other_period)

    a = await _create_activity(client, project, live_period, "Excavation")
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(other_period.id), "task_name": "Piling",
    })
    assert resp.status_code == 201
    b = resp.json()

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    assert resp.status_code == 422
    assert "same period" in resp.json()["detail"].lower()


async def test_list_relationships_by_period(client: AsyncClient, project: Project, live_period: Period):
    a = await _create_activity(client, project, live_period, "Excavation")
    b = await _create_activity(client, project, live_period, "Piling")
    c = await _create_activity(client, project, live_period, "Pile caps")
    await client.post("/api/v1/activity-relationships/", json={"predecessor_id": a["id"], "successor_id": b["id"]})
    await client.post("/api/v1/activity-relationships/", json={"predecessor_id": b["id"], "successor_id": c["id"]})

    resp = await client.get("/api/v1/activity-relationships/", params={"period_id": str(live_period.id)})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_update_relationship_type_and_lag(client: AsyncClient, project: Project, live_period: Period):
    a = await _create_activity(client, project, live_period, "Excavation")
    b = await _create_activity(client, project, live_period, "Piling")
    create = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    rel_id = create.json()["id"]

    resp = await client.patch(f"/api/v1/activity-relationships/{rel_id}", json={
        "relationship_type": "SS", "lag_days": -3,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["relationship_type"] == "SS"
    assert data["lag_days"] == -3


async def test_delete_relationship(client: AsyncClient, project: Project, live_period: Period):
    a = await _create_activity(client, project, live_period, "Excavation")
    b = await _create_activity(client, project, live_period, "Piling")
    create = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    rel_id = create.json()["id"]

    resp = await client.delete(f"/api/v1/activity-relationships/{rel_id}")
    assert resp.status_code == 204

    resp = await client.get("/api/v1/activity-relationships/", params={"period_id": str(live_period.id)})
    assert resp.json() == []


async def test_delete_activity_cascades_relationships(
    client: AsyncClient, project: Project, live_period: Period
):
    a = await _create_activity(client, project, live_period, "Excavation")
    b = await _create_activity(client, project, live_period, "Piling")
    await client.post("/api/v1/activity-relationships/", json={"predecessor_id": a["id"], "successor_id": b["id"]})

    resp = await client.delete(f"/api/v1/activities/{a['id']}")
    assert resp.status_code == 204

    resp = await client.get("/api/v1/activity-relationships/", params={"period_id": str(live_period.id)})
    assert resp.json() == []


# --- Constraints -------------------------------------------------------------

async def test_constraint_requires_date_except_asap(
    client: AsyncClient, project: Project, live_period: Period
):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Piling",
        "constraint_type": "ms",
    })
    assert resp.status_code == 422


async def test_constraint_date_rejected_without_type(
    client: AsyncClient, project: Project, live_period: Period
):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Piling",
        "constraint_date": "2025-06-01",
    })
    assert resp.status_code == 422


async def test_constraint_with_matching_date_accepted(
    client: AsyncClient, project: Project, live_period: Period
):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Piling",
        "constraint_type": "fnlt", "constraint_date": "2025-06-01",
    })
    assert resp.status_code == 201
    assert resp.json()["constraint_type"] == "fnlt"


async def test_update_constraint_inconsistent_state_rejected(
    client: AsyncClient, project: Project, live_period: Period
):
    create = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Piling",
    })
    activity_id = create.json()["id"]

    resp = await client.patch(f"/api/v1/activities/{activity_id}", json={"constraint_type": "ms"})
    assert resp.status_code == 422
