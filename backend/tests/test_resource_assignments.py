from __future__ import annotations

from httpx import AsyncClient

from app.models.schedule_period import SchedulePeriod
from app.models.project import Project


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_resource(client: AsyncClient, project: Project, **overrides) -> dict:
    payload = {"project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "45"}
    payload.update(overrides)
    resp = await client.post("/api/v1/resources/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_labour_assignment_costed_by_duration_and_utilisation(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    """Labour/equipment: budget = activity.duration_days x utilisation% x day rate —
    per Maro's confirmed spec, cost follows the schedule automatically."""
    activity = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=40)  # 5 days at 8h/day
    resource = await _create_resource(client, project, rate="100")

    resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "role": "Site Engineer", "utilisation_pct": "50",
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["resource_name"] == "J. Davies"
    assert data["role"] == "Site Engineer"
    assert float(data["budget"]) == 250.0  # 5 days * 50% * 100


async def test_labour_assignment_defaults_to_full_utilisation(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    activity = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=40)  # 5 days
    resource = await _create_resource(client, project, rate="100")

    resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"],
    })
    assert resp.status_code == 201
    assert float(resp.json()["budget"]) == 500.0  # 5 days * 100% * 100


async def test_material_assignment_requires_quantity(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity = await _create_activity(client, project, live_schedule_period, "Piling")
    resource = await _create_resource(client, project, resource_type="material", name="CFA Piles", unit="nr", rate="576")

    resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"],
    })
    assert resp.status_code == 422
    assert "quantity" in resp.json()["detail"].lower()


async def test_material_assignment_costed_by_quantity(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity = await _create_activity(client, project, live_schedule_period, "Piling")
    resource = await _create_resource(client, project, resource_type="material", name="CFA Piles", unit="nr", rate="576")

    resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "quantity": "267",
    })
    assert resp.status_code == 201
    assert float(resp.json()["budget"]) == 267 * 576.0


async def test_subcontractor_lump_sum_assignment(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity = await _create_activity(client, project, live_schedule_period, "Piling")
    resource = await _create_resource(
        client, project, resource_type="subcontractor", name="Piling Contractor (Huber)",
        unit="lump sum", rate="354451",
    )

    resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"],
    })
    assert resp.status_code == 201
    assert float(resp.json()["budget"]) == 354451.0


async def test_crew_assignment_costed_by_duration_and_utilisation(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    """crew: same formula as labour/equipment — it occupies activity time the
    same way (2026-07-08, per Maro)."""
    activity = await _create_activity(client, project, live_schedule_period, "Bulk Excavation", duration_hours=40)  # 5 days
    resource = await _create_resource(client, project, resource_type="crew", name="Excavation Crew", rate="2480")

    resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "50",
    })
    assert resp.status_code == 201, resp.text
    assert float(resp.json()["budget"]) == 6200.0  # 5 days * 50% * 2480


async def test_cost_resource_lump_sum_assignment(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    """cost: same flat-rate formula as subcontractor — cost_type is informational
    only this pass (2026-07-08, per Maro)."""
    activity = await _create_activity(client, project, live_schedule_period, "Planning")
    resource = await _create_resource(
        client, project, resource_type="cost", name="Planning Permission Fee",
        unit="lump sum", rate="18750", cost_type="fixed",
    )

    resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"],
    })
    assert resp.status_code == 201, resp.text
    assert float(resp.json()["budget"]) == 18750.0


async def test_list_assignments_by_activity(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity = await _create_activity(client, project, live_schedule_period, "Piling")
    other_activity = await _create_activity(client, project, live_schedule_period, "Groundworks")
    r1 = await _create_resource(client, project, name="J. Davies")
    r2 = await _create_resource(client, project, name="360 Excavator", resource_type="equipment")

    await client.post("/api/v1/resource-assignments/", json={"activity_id": activity["id"], "resource_id": r1["id"]})
    await client.post("/api/v1/resource-assignments/", json={"activity_id": other_activity["id"], "resource_id": r2["id"]})

    resp = await client.get("/api/v1/resource-assignments/", params={"activity_id": activity["id"]})
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_list_assignments_by_period(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity = await _create_activity(client, project, live_schedule_period, "Piling")
    other_activity = await _create_activity(client, project, live_schedule_period, "Groundworks")
    r1 = await _create_resource(client, project, name="J. Davies")
    r2 = await _create_resource(client, project, name="360 Excavator", resource_type="equipment")

    await client.post("/api/v1/resource-assignments/", json={"activity_id": activity["id"], "resource_id": r1["id"]})
    await client.post("/api/v1/resource-assignments/", json={"activity_id": other_activity["id"], "resource_id": r2["id"]})

    resp = await client.get("/api/v1/resource-assignments/", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_list_assignments_requires_a_filter(client: AsyncClient):
    resp = await client.get("/api/v1/resource-assignments/")
    assert resp.status_code == 422


async def test_update_utilisation_recomputes_budget(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=80)  # 10 days
    resource = await _create_resource(client, project, rate="45")
    create = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })
    assignment_id = create.json()["id"]
    assert float(create.json()["budget"]) == 450.0  # 10 days * 100% * 45

    resp = await client.patch(f"/api/v1/resource-assignments/{assignment_id}", json={"utilisation_pct": "50"})
    assert resp.status_code == 200
    assert float(resp.json()["budget"]) == 225.0  # 10 days * 50% * 45


async def test_delete_assignment(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity = await _create_activity(client, project, live_schedule_period, "Piling")
    resource = await _create_resource(client, project)
    create = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"],
    })
    assignment_id = create.json()["id"]

    resp = await client.delete(f"/api/v1/resource-assignments/{assignment_id}")
    assert resp.status_code == 204

    resp = await client.get("/api/v1/resource-assignments/", params={"activity_id": activity["id"]})
    assert resp.json() == []


async def test_resource_from_other_project_rejected(
    client: AsyncClient, db, project: Project, live_schedule_period: SchedulePeriod, org
):
    from app.models.project import Project as ProjectModel

    other_project = ProjectModel(org_id=org.id, name="Other Project")
    db.add(other_project)
    await db.commit()
    await db.refresh(other_project)

    activity = await _create_activity(client, project, live_schedule_period, "Piling")
    foreign_resource = await _create_resource(client, other_project)

    resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": foreign_resource["id"],
    })
    assert resp.status_code == 404


async def test_cannot_delete_resource_in_use(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity = await _create_activity(client, project, live_schedule_period, "Piling")
    resource = await _create_resource(client, project)
    await client.post("/api/v1/resource-assignments/", json={"activity_id": activity["id"], "resource_id": resource["id"]})

    resp = await client.delete(f"/api/v1/resources/{resource['id']}")
    assert resp.status_code == 422
    assert "assigned" in resp.json()["detail"].lower()


async def test_assignment_rejects_frozen_period(
    client: AsyncClient, db, project: Project, schedule_variant, frozen_schedule_period: SchedulePeriod
):
    from app.models.activity import Activity

    activity = Activity(project_id=project.id, schedule_variant_id=schedule_variant.id, schedule_period_id=frozen_schedule_period.id, task_name="Frozen", code="ACT-9101")
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    resource_resp = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "45",
    })

    resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": str(activity.id), "resource_id": resource_resp.json()["id"],
    })
    assert resp.status_code == 422
    assert "frozen" in resp.json()["detail"].lower()
