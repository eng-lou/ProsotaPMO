from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


async def test_create_and_list_profile(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/animation-profiles/", json={
        "project_id": str(project.id), "name": "Pop Up Y",
        "config": {"transform_kind": "pop", "axis": "y"},
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Pop Up Y"
    assert created["config"]["transform_kind"] == "pop"
    assert created["config"]["axis"] == "y"

    listing = (await client.get("/api/v1/animation-profiles/", params={"project_id": str(project.id)})).json()
    assert any(p["id"] == created["id"] for p in listing)


async def test_create_defaults(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/animation-profiles/", json={"project_id": str(project.id), "name": "Bare"})
    assert resp.status_code == 201, resp.text
    config = resp.json()["config"]
    assert config["trigger"] == "over_duration"
    assert config["transform_kind"] == "none"
    assert config["opacity_from"] == 0.0
    assert config["opacity_to"] == 1.0
    assert config["interpolation"] == "linear"
    assert config["duration_frames"] is None


async def test_update_profile_renames_and_reconfigures(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/animation-profiles/", json={
        "project_id": str(project.id), "name": "Draft", "config": {"transform_kind": "fall", "axis": "z"},
    })
    profile_id = create_resp.json()["id"]

    update_resp = await client.patch(f"/api/v1/animation-profiles/{profile_id}", json={
        "name": "Fall Down Z", "config": {"transform_kind": "fall", "axis": "z", "direction": -1, "distance": 3.0},
    })
    assert update_resp.status_code == 200, update_resp.text
    assert update_resp.json()["name"] == "Fall Down Z"
    assert update_resp.json()["config"]["direction"] == -1
    assert update_resp.json()["config"]["distance"] == 3.0


async def test_update_unknown_profile_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/animation-profiles/{uuid.uuid4()}", json={"name": "X"})
    assert resp.status_code == 404


async def test_delete_profile(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/animation-profiles/", json={"project_id": str(project.id), "name": "Temp"})
    profile_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/animation-profiles/{profile_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/animation-profiles/", params={"project_id": str(project.id)})).json()
    assert all(p["id"] != profile_id for p in listing)


async def test_delete_unknown_profile_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/animation-profiles/{uuid.uuid4()}")
    assert resp.status_code == 404
