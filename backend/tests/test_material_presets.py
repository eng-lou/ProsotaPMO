from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


def _create_data(project_id: str, name: str = "Brick Facade"):
    return {"project_id": project_id, "name": name}


def _files(**slots: bytes) -> dict:
    return {slot: (f"{slot}.png", content, "image/png") for slot, content in slots.items()}


async def test_create_and_list_preset(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/material-presets/", data=_create_data(str(project.id)), files=_files(map=b"albedo-bytes"))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Brick Facade"
    assert len(created["textures"]) == 1
    assert created["textures"][0]["slot"] == "map"
    assert created["textures"][0]["name"] == "map.png"

    listing = (await client.get("/api/v1/material-presets/", params={"project_id": str(project.id)})).json()
    assert any(p["id"] == created["id"] for p in listing)


async def test_create_with_no_files_has_no_textures(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/material-presets/", data=_create_data(str(project.id), "Bare"))
    assert resp.status_code == 201, resp.text
    assert resp.json()["textures"] == []


async def test_create_with_multiple_slots(client: AsyncClient, project: Project):
    resp = await client.post(
        "/api/v1/material-presets/", data=_create_data(str(project.id), "Weathered Steel"),
        files=_files(map=b"albedo", roughnessMap=b"rough", normalMap=b"normal"),
    )
    assert resp.status_code == 201, resp.text
    slots = {t["slot"] for t in resp.json()["textures"]}
    assert slots == {"map", "roughnessMap", "normalMap"}


async def test_download_texture_round_trips_bytes(client: AsyncClient, project: Project):
    created = (await client.post(
        "/api/v1/material-presets/", data=_create_data(str(project.id)), files=_files(map=b"exact-bytes-here"),
    )).json()

    download = await client.get(f"/api/v1/material-presets/{created['id']}/textures/map")
    assert download.status_code == 200
    assert download.content == b"exact-bytes-here"


async def test_download_missing_slot_404s(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/material-presets/", data=_create_data(str(project.id)))).json()
    resp = await client.get(f"/api/v1/material-presets/{created['id']}/textures/map")
    assert resp.status_code == 404


async def test_update_rename_leaves_existing_texture_untouched(client: AsyncClient, project: Project):
    # The whole point of cleared_slots/omitted-slots (2026-07-13, per the
    # real incident this table exists to fix): renaming a preset must not
    # require re-uploading every large texture it already has.
    created = (await client.post(
        "/api/v1/material-presets/", data=_create_data(str(project.id), "Draft"), files=_files(map=b"original-bytes"),
    )).json()

    update = await client.patch(f"/api/v1/material-presets/{created['id']}", data={"name": "Weathered Steel", "cleared_slots": ""})
    assert update.status_code == 200, update.text
    assert update.json()["name"] == "Weathered Steel"
    assert len(update.json()["textures"]) == 1

    download = await client.get(f"/api/v1/material-presets/{created['id']}/textures/map")
    assert download.content == b"original-bytes"  # untouched, not re-uploaded/cleared


async def test_update_replaces_slot(client: AsyncClient, project: Project):
    created = (await client.post(
        "/api/v1/material-presets/", data=_create_data(str(project.id)), files=_files(map=b"old-bytes"),
    )).json()

    await client.patch(
        f"/api/v1/material-presets/{created['id']}", data={"name": created["name"], "cleared_slots": ""},
        files=_files(map=b"new-bytes"),
    )
    download = await client.get(f"/api/v1/material-presets/{created['id']}/textures/map")
    assert download.content == b"new-bytes"


async def test_update_clears_slot_without_replacement(client: AsyncClient, project: Project):
    created = (await client.post(
        "/api/v1/material-presets/", data=_create_data(str(project.id)),
        files=_files(map=b"albedo-bytes", roughnessMap=b"rough-bytes"),
    )).json()

    update = await client.patch(
        f"/api/v1/material-presets/{created['id']}", data={"name": created["name"], "cleared_slots": "roughnessMap"},
    )
    assert update.status_code == 200, update.text
    slots = {t["slot"] for t in update.json()["textures"]}
    assert slots == {"map"}  # roughnessMap gone, map untouched

    assert (await client.get(f"/api/v1/material-presets/{created['id']}/textures/roughnessMap")).status_code == 404
    assert (await client.get(f"/api/v1/material-presets/{created['id']}/textures/map")).status_code == 200


async def test_update_unknown_preset_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/material-presets/{uuid.uuid4()}", data={"name": "X", "cleared_slots": ""})
    assert resp.status_code == 404


async def test_delete_preset_removes_row_and_texture_files(client: AsyncClient, project: Project):
    created = (await client.post(
        "/api/v1/material-presets/", data=_create_data(str(project.id), "Temp"), files=_files(map=b"some-bytes"),
    )).json()

    del_resp = await client.delete(f"/api/v1/material-presets/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/material-presets/", params={"project_id": str(project.id)})).json()
    assert all(p["id"] != created["id"] for p in listing)

    # The preset row (and its texture rows via CASCADE) are gone -- a
    # download 404ing is the observable proof, same convention
    # test_model3d_files.py's own delete test already uses.
    download_resp = await client.get(f"/api/v1/material-presets/{created['id']}/textures/map")
    assert download_resp.status_code == 404


async def test_delete_unknown_preset_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/material-presets/{uuid.uuid4()}")
    assert resp.status_code == 404
