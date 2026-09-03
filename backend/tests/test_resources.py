from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def test_create_resource(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies",
        "unit": "hour", "rate": "45.00",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "J. Davies"
    assert data["resource_type"] == "labour"
    assert float(data["rate"]) == 45.0


async def test_create_and_update_resource_role(client: AsyncClient, project: Project):
    create = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies",
        "role": "Trades", "unit": "day", "rate": "220",
    })
    assert create.status_code == 201, create.text
    data = create.json()
    assert data["role"] == "Trades"

    resp = await client.patch(f"/api/v1/resources/{data['id']}", json={"role": "Foreman"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "Foreman"


async def test_resource_role_defaults_to_null(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "220",
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["role"] is None


async def test_list_resources_by_project(client: AsyncClient, project: Project):
    for name, rtype in [("J. Davies", "labour"), ("360 Excavator", "equipment")]:
        await client.post("/api/v1/resources/", json={
            "project_id": str(project.id), "resource_type": rtype, "name": name, "unit": "day", "rate": "100",
        })
    resp = await client.get("/api/v1/resources/", params={"project_id": str(project.id)})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_update_resource(client: AsyncClient, project: Project):
    create = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "material", "name": "Ready-mix Concrete",
        "unit": "m3", "rate": "120",
    })
    resource_id = create.json()["id"]

    resp = await client.patch(f"/api/v1/resources/{resource_id}", json={"rate": "135.50"})
    assert resp.status_code == 200
    assert float(resp.json()["rate"]) == 135.5


async def test_delete_unused_resource(client: AsyncClient, project: Project):
    create = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "equipment", "name": "Tower Crane",
        "unit": "day", "rate": "800",
    })
    resource_id = create.json()["id"]

    resp = await client.delete(f"/api/v1/resources/{resource_id}")
    assert resp.status_code == 204


async def test_bulk_delete_resources(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    """POST /resources/bulk-delete-all (2026-09-03, per Maro: "takes a long
    time to delete... all resources" — see
    app/services/resource.py:bulk_delete_resources). Covers the assigned-
    resource path too, not just the trivially-unused one
    test_delete_unused_resource already covers — a real pool is rarely all
    unassigned."""
    assigned = (await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "220",
    })).json()
    unassigned = (await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "equipment", "name": "Tower Crane", "unit": "day", "rate": "800",
    })).json()
    activity = (await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id), "task_name": "Piling",
    })).json()
    assign = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": assigned["id"],
    })
    assert assign.status_code == 201, assign.text

    resp = await client.post("/api/v1/resources/bulk-delete-all", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"deleted_count": 2, "skipped_names": []}

    resp = await client.get("/api/v1/resources/", params={"project_id": str(project.id)})
    assert resp.json() == []

    resp = await client.get("/api/v1/resource-assignments/", params={"activity_id": activity["id"]})
    assert resp.json() == []


async def test_get_resource_not_found(client: AsyncClient):
    resp = await client.get("/api/v1/resources/", params={"project_id": str(uuid.uuid4())})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_create_resource_with_calendar(client: AsyncClient, project: Project):
    calendar = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Subcontractor Weekend Crew", "works_saturday": True, "works_sunday": True,
    })
    calendar_id = calendar.json()["id"]

    resp = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "subcontractor", "name": "Weekend Groundworks Crew",
        "unit": "lump sum", "rate": "5000", "calendar_id": calendar_id,
    })
    assert resp.status_code == 201
    assert resp.json()["calendar_id"] == calendar_id


async def test_update_resource_calendar(client: AsyncClient, project: Project):
    create = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "Steel Fixers", "unit": "day", "rate": "220",
    })
    resource_id = create.json()["id"]
    assert create.json()["calendar_id"] is None

    calendar = await client.post("/api/v1/calendars/", json={"project_id": str(project.id), "name": "Night Shift"})
    calendar_id = calendar.json()["id"]

    resp = await client.patch(f"/api/v1/resources/{resource_id}", json={"calendar_id": calendar_id})
    assert resp.status_code == 200
    assert resp.json()["calendar_id"] == calendar_id

    # Clearing it back to null (no calendar of its own) must also work.
    resp = await client.patch(f"/api/v1/resources/{resource_id}", json={"calendar_id": None})
    assert resp.status_code == 200
    assert resp.json()["calendar_id"] is None


async def test_create_resource_rejects_calendar_from_another_project(client: AsyncClient, project: Project):
    other_project = await client.post("/api/v1/projects/", json={"name": "Other Project", "client_name": "X"})
    other_calendar = await client.post("/api/v1/calendars/", json={"project_id": other_project.json()["id"], "name": "Foreign Calendar"})

    resp = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies",
        "unit": "day", "rate": "220", "calendar_id": other_calendar.json()["id"],
    })
    assert resp.status_code == 404


async def test_create_cost_resource(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "cost", "name": "Planning Permission Fee",
        "unit": "lump sum", "rate": "18750.00", "cost_type": "fixed",
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["resource_type"] == "cost"
    assert data["cost_type"] == "fixed"


async def test_create_crew_resource(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "crew", "name": "Excavation Crew",
        "unit": "day", "rate": "2480.00", "members": "1x Excavator, 2x Labourers",
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["resource_type"] == "crew"
    assert data["members"] == "1x Excavator, 2x Labourers"


async def test_classification_fields_round_trip(client: AsyncClient, project: Project):
    create = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies",
        "unit": "day", "rate": "220", "discipline": "Structural Engineering", "company": "ABC Civil Engineering Ltd",
        "skill_level": "Skilled",
    })
    assert create.status_code == 201, create.text
    data = create.json()
    assert data["discipline"] == "Structural Engineering"
    assert data["company"] == "ABC Civil Engineering Ltd"
    assert data["skill_level"] == "Skilled"
    assert data["category"] is None
    assert data["members"] is None

    resp = await client.patch(f"/api/v1/resources/{data['id']}", json={"category": "Concrete"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["category"] == "Concrete"
