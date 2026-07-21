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
    # Never accepted/saved unless the caller actually sends them — a plain
    # camera-only save (no isolation/thumbnail captured) stays null, not a
    # fabricated empty object.
    assert created["viewport_state"] is None
    assert created["thumbnail_data_url"] is None

    listing = (await client.get("/api/v1/camera-views/", params={"project_id": str(project.id)})).json()
    assert any(v["id"] == created["id"] for v in listing)


async def test_create_camera_view_with_viewport_state_and_thumbnail(client: AsyncClient, project: Project):
    viewport_state = {
        "isolate_mode": True,
        "isolated_object_ids": ["ifc-0"],
        "isolated_express_ids": [101, 102],
        "isolated_ifc_model_id": "ifc-0",
        "hidden_ids": [],
        "hidden_express_ids": [],
        "show_clash_colors": True,
    }
    resp = await client.post("/api/v1/camera-views/", json=_view_payload(
        str(project.id), viewport_state=viewport_state, thumbnail_data_url="data:image/png;base64,abc123",
    ))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["viewport_state"] == viewport_state
    assert created["thumbnail_data_url"] == "data:image/png;base64,abc123"


async def test_update_camera_view_viewport_state(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/camera-views/", json=_view_payload(str(project.id)))).json()
    assert created["viewport_state"] is None

    viewport_state = {
        "isolate_mode": False, "isolated_object_ids": [], "isolated_express_ids": [],
        "isolated_ifc_model_id": None, "hidden_ids": ["mesh-1"], "hidden_express_ids": [], "show_clash_colors": False,
    }
    resp = await client.patch(f"/api/v1/camera-views/{created['id']}", json={"viewport_state": viewport_state})
    assert resp.status_code == 200, resp.text
    assert resp.json()["viewport_state"] == viewport_state


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
