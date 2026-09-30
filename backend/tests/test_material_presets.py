from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.models.project import Project
from tests.conftest import FakeObjectStorage

# Texture bytes are stored in R2 (2026-08-23); faked in memory (conftest.py).
pytestmark = pytest.mark.usefixtures("fake_object_storage")


async def _texture_bytes(client: AsyncClient, storage: FakeObjectStorage, preset_id: str, slot: str = "map") -> bytes:
    # Downloads redirect to a presigned storage url.
    resp = await client.get(f"/api/v1/material-presets/{preset_id}/textures/{slot}")
    assert resp.status_code == 307, resp.text
    return storage.read_url(resp.headers["location"])


async def _textures(client: AsyncClient, storage: FakeObjectStorage, **slots: bytes) -> dict:
    """Plays the browser's part (2026-09-30): presign + PUT each texture
    straight to storage, returning the `textures` payload to register."""
    out = {}
    for slot, content in slots.items():
        key = await storage.presign_and_put(client, "/api/v1/material-presets/presign", content, name=f"{slot}.png")
        out[slot] = {"storage_key": key, "name": f"{slot}.png"}
    return out


async def _create(
    client: AsyncClient, storage: FakeObjectStorage, project_id: str, name: str = "Brick Facade", **slots: bytes,
):
    return await client.post("/api/v1/material-presets/", json={
        "project_id": project_id, "name": name, "textures": await _textures(client, storage, **slots),
    })


async def test_create_and_list_preset(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    resp = await _create(client, fake_object_storage, str(project.id), map=b"albedo-bytes")
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Brick Facade"
    assert len(created["textures"]) == 1
    assert created["textures"][0]["slot"] == "map"
    assert created["textures"][0]["name"] == "map.png"

    listing = (await client.get("/api/v1/material-presets/", params={"project_id": str(project.id)})).json()
    assert any(p["id"] == created["id"] for p in listing)


async def test_create_with_no_files_has_no_textures(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    resp = await _create(client, fake_object_storage, str(project.id), "Bare")
    assert resp.status_code == 201, resp.text
    assert resp.json()["textures"] == []


async def test_create_with_multiple_slots(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    resp = await _create(
        client, fake_object_storage, str(project.id), "Weathered Steel",
        map=b"albedo", roughnessMap=b"rough", normalMap=b"normal",
    )
    assert resp.status_code == 201, resp.text
    slots = {t["slot"] for t in resp.json()["textures"]}
    assert slots == {"map", "roughnessMap", "normalMap"}


async def test_download_texture_round_trips_bytes(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await _create(client, fake_object_storage, str(project.id), map=b"exact-bytes-here")).json()

    assert await _texture_bytes(client, fake_object_storage, created["id"]) == b"exact-bytes-here"


async def test_download_missing_slot_404s(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await _create(client, fake_object_storage, str(project.id))).json()
    resp = await client.get(f"/api/v1/material-presets/{created['id']}/textures/map")
    assert resp.status_code == 404


async def test_update_rename_leaves_existing_texture_untouched(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    # The whole point of cleared_slots/omitted-slots (2026-07-13, per the
    # real incident this table exists to fix): renaming a preset must not
    # require re-uploading every large texture it already has.
    created = (await _create(client, fake_object_storage, str(project.id), "Draft", map=b"original-bytes")).json()

    update = await client.patch(f"/api/v1/material-presets/{created['id']}", json={"name": "Weathered Steel"})
    assert update.status_code == 200, update.text
    assert update.json()["name"] == "Weathered Steel"
    assert len(update.json()["textures"]) == 1
    assert update.json()["textures"][0]["id"] == created["textures"][0]["id"]

    assert await _texture_bytes(client, fake_object_storage, created["id"]) == b"original-bytes"  # untouched, not re-uploaded/cleared


async def test_update_replaces_slot(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await _create(client, fake_object_storage, str(project.id), map=b"old-bytes")).json()
    old_key = next(iter(fake_object_storage.objects))

    update = await client.patch(
        f"/api/v1/material-presets/{created['id']}",
        json={"name": created["name"], "textures": await _textures(client, fake_object_storage, map=b"new-bytes")},
    )
    assert update.status_code == 200, update.text
    assert await _texture_bytes(client, fake_object_storage, created["id"]) == b"new-bytes"
    # New bytes get a new texture id (the frontend caches texture bytes by
    # id), and the old stored object is deleted, not orphaned.
    assert update.json()["textures"][0]["id"] != created["textures"][0]["id"]
    assert old_key not in fake_object_storage.objects


async def test_update_clears_slot_without_replacement(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await _create(
        client, fake_object_storage, str(project.id), map=b"albedo-bytes", roughnessMap=b"rough-bytes",
    )).json()

    update = await client.patch(
        f"/api/v1/material-presets/{created['id']}", json={"name": created["name"], "cleared_slots": ["roughnessMap"]},
    )
    assert update.status_code == 200, update.text
    slots = {t["slot"] for t in update.json()["textures"]}
    assert slots == {"map"}  # roughnessMap gone, map untouched

    assert (await client.get(f"/api/v1/material-presets/{created['id']}/textures/roughnessMap")).status_code == 404
    assert (await client.get(f"/api/v1/material-presets/{created['id']}/textures/map")).status_code == 307


async def test_update_unknown_preset_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/material-presets/{uuid.uuid4()}", json={"name": "X"})
    assert resp.status_code == 404


async def test_delete_preset_removes_row_and_texture_files(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await _create(client, fake_object_storage, str(project.id), "Temp", map=b"some-bytes")).json()

    del_resp = await client.delete(f"/api/v1/material-presets/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/material-presets/", params={"project_id": str(project.id)})).json()
    assert all(p["id"] != created["id"] for p in listing)
    assert fake_object_storage.objects == {}

    # The preset row (and its texture rows via CASCADE) are gone -- a
    # download 404ing is the observable proof, same convention
    # test_model3d_files.py's own delete test already uses.
    download_resp = await client.get(f"/api/v1/material-presets/{created['id']}/textures/map")
    assert download_resp.status_code == 404


async def test_delete_unknown_preset_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/material-presets/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_create_rejects_storage_key_from_another_feature(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/material-presets/", json={
        "project_id": str(project.id), "name": "X",
        "textures": {"map": {"storage_key": "model3d/someone-elses-file.ifc", "name": "map.png"}},
    })
    assert resp.status_code == 400


async def test_create_rejects_never_uploaded_texture(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/material-presets/", json={
        "project_id": str(project.id), "name": "X",
        "textures": {"map": {"storage_key": "material-presets/never-uploaded.png", "name": "map.png"}},
    })
    assert resp.status_code == 400
