from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


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


async def test_get_resource_not_found(client: AsyncClient):
    resp = await client.get("/api/v1/resources/", params={"project_id": str(uuid.uuid4())})
    assert resp.status_code == 200
    assert resp.json() == []
