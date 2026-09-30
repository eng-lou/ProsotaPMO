from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.models.project import Project
from tests.conftest import FakeObjectStorage

# Environment bytes are stored in R2; faked in memory (conftest.py).
pytestmark = pytest.mark.usefixtures("fake_object_storage")


async def _set(client: AsyncClient, storage: FakeObjectStorage, project_id: str, content: bytes, name: str = "sky.hdr"):
    key = await storage.presign_and_put(client, "/api/v1/environment-maps/presign", content, name=name)
    return await client.post("/api/v1/environment-maps/", json={"project_id": project_id, "name": name, "storage_key": key})


async def test_no_environment_returns_null(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/environment-maps/", params={"project_id": str(project.id)})
    assert resp.status_code == 200
    assert resp.json() is None


async def test_set_get_and_download(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = await _set(client, fake_object_storage, str(project.id), b"hdr-bytes")
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "sky.hdr"
    assert body["size_bytes"] == len(b"hdr-bytes")

    got = (await client.get("/api/v1/environment-maps/", params={"project_id": str(project.id)})).json()
    assert got["id"] == body["id"]

    download = await client.get(f"/api/v1/environment-maps/{body['id']}/download")
    assert download.status_code == 307
    assert fake_object_storage.read_url(download.headers["location"]) == b"hdr-bytes"


async def test_new_upload_replaces_old_with_new_id(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    first = (await _set(client, fake_object_storage, str(project.id), b"old", "a.hdr")).json()
    second = (await _set(client, fake_object_storage, str(project.id), b"new", "b.exr")).json()

    # New id (the frontend caches by id) and the old stored object deleted.
    assert second["id"] != first["id"]
    assert list(fake_object_storage.objects.values()) == [b"new"]
    got = (await client.get("/api/v1/environment-maps/", params={"project_id": str(project.id)})).json()
    assert got["name"] == "b.exr"
    assert (await client.get(f"/api/v1/environment-maps/{first['id']}/download")).status_code == 404


async def test_delete_clears_environment(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await _set(client, fake_object_storage, str(project.id), b"hdr")).json()
    assert (await client.delete(f"/api/v1/environment-maps/{created['id']}")).status_code == 204
    assert fake_object_storage.objects == {}
    assert (await client.get("/api/v1/environment-maps/", params={"project_id": str(project.id)})).json() is None


async def test_delete_unknown_404s(client: AsyncClient):
    assert (await client.delete(f"/api/v1/environment-maps/{uuid.uuid4()}")).status_code == 404


async def test_rejects_foreign_or_missing_storage_key(client: AsyncClient, project: Project):
    for key in ["model3d/someone-elses.ifc", "environment-maps/never-uploaded.hdr"]:
        resp = await client.post("/api/v1/environment-maps/", json={"project_id": str(project.id), "name": "x.hdr", "storage_key": key})
        assert resp.status_code == 400, key
