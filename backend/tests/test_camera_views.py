from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


def _view_payload(project_id: str, **overrides) -> dict:
    payload = {
        "project_id": project_id, "name": "East Elevation",
        "position_x": 10.0, "position_y": 5.0, "position_z": 10.0,
        "target_x": 0.0, "target_y": 0.0, "target_z": 0.0,
    }
    payload.update(overrides)
    return payload


async def test_create_and_list_camera_view(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/camera-views/", json=_view_payload(str(project.id)))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "East Elevation"
    assert created["project_id"] == str(project.id)
    assert created["position_x"] == 10.0

    listing = (await client.get("/api/v1/camera-views/", params={"project_id": str(project.id)})).json()
    assert any(v["id"] == created["id"] for v in listing)


async def test_rename_and_reposition_camera_view(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/camera-views/", json=_view_payload(str(project.id)))).json()

    resp = await client.patch(f"/api/v1/camera-views/{created['id']}", json={"name": "Plant Room", "position_x": 20.0})
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["name"] == "Plant Room"
    assert updated["position_x"] == 20.0
    assert updated["position_y"] == 5.0  # untouched fields stay as they were


async def test_update_unknown_camera_view_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/camera-views/{uuid.uuid4()}", json={"name": "New Name"})
    assert resp.status_code == 404


async def test_delete_camera_view(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/camera-views/", json=_view_payload(str(project.id)))).json()

    del_resp = await client.delete(f"/api/v1/camera-views/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/camera-views/", params={"project_id": str(project.id)})).json()
    assert all(v["id"] != created["id"] for v in listing)


async def test_delete_unknown_camera_view_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/camera-views/{uuid.uuid4()}")
    assert resp.status_code == 404
