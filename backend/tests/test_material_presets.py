from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project

TINY_PNG_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


async def test_create_and_list_preset(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/material-presets/", json={
        "project_id": str(project.id), "name": "Brick Facade",
        "config": {"map": {"data_uri": TINY_PNG_DATA_URI, "name": "brick.png"}},
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Brick Facade"
    assert created["config"]["map"]["name"] == "brick.png"
    assert created["config"]["metalnessMap"] is None

    listing = (await client.get("/api/v1/material-presets/", params={"project_id": str(project.id)})).json()
    assert any(p["id"] == created["id"] for p in listing)


async def test_create_defaults_to_empty_slots(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/material-presets/", json={"project_id": str(project.id), "name": "Bare"})
    assert resp.status_code == 201, resp.text
    config = resp.json()["config"]
    assert config["map"] is None
    assert config["metalnessMap"] is None
    assert config["roughnessMap"] is None
    assert config["normalMap"] is None


async def test_update_preset_renames_and_reconfigures(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/material-presets/", json={
        "project_id": str(project.id), "name": "Draft",
        "config": {"map": {"data_uri": TINY_PNG_DATA_URI, "name": "a.png"}},
    })
    preset_id = create_resp.json()["id"]

    update_resp = await client.patch(f"/api/v1/material-presets/{preset_id}", json={
        "name": "Weathered Steel",
        "config": {
            "map": {"data_uri": TINY_PNG_DATA_URI, "name": "steel.png"},
            "roughnessMap": {"data_uri": TINY_PNG_DATA_URI, "name": "steel_rough.png"},
        },
    })
    assert update_resp.status_code == 200, update_resp.text
    assert update_resp.json()["name"] == "Weathered Steel"
    assert update_resp.json()["config"]["map"]["name"] == "steel.png"
    assert update_resp.json()["config"]["roughnessMap"]["name"] == "steel_rough.png"


async def test_update_unknown_preset_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/material-presets/{uuid.uuid4()}", json={"name": "X"})
    assert resp.status_code == 404


async def test_delete_preset(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/material-presets/", json={"project_id": str(project.id), "name": "Temp"})
    preset_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/material-presets/{preset_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/material-presets/", params={"project_id": str(project.id)})).json()
    assert all(p["id"] != preset_id for p in listing)


async def test_delete_unknown_preset_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/material-presets/{uuid.uuid4()}")
    assert resp.status_code == 404
