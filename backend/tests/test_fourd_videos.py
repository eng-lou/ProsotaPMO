from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.models.project import Project
from tests.conftest import FakeObjectStorage

pytestmark = pytest.mark.usefixtures("fake_object_storage")


# Direct-to-R2 upload flow (2026-08-23, 51e97fc): presign, PUT the bytes to
# the returned url, then register the storage_key with the JSON create call.
async def upload_video(
    client: AsyncClient, storage: FakeObjectStorage, project_id: str, name: str = "sequence.webm",
    duration_sec: float = 8.0, content: bytes = b"fake-webm-bytes", content_type: str = "video/webm",
):
    storage_key = await storage.presign_and_put(client, "/api/v1/fourd-videos/presign", content, content_type=content_type)
    return await client.post("/api/v1/fourd-videos/", json={
        "project_id": project_id, "name": name, "duration_sec": duration_sec, "storage_key": storage_key,
    })


async def test_upload_and_list_video(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    resp = await upload_video(client, fake_object_storage, str(project.id))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "sequence.webm"
    assert created["duration_sec"] == 8.0
    assert created["size_bytes"] == len(b"fake-webm-bytes")

    listing = (await client.get("/api/v1/fourd-videos/", params={"project_id": str(project.id)})).json()
    assert any(v["id"] == created["id"] for v in listing)


async def test_register_without_uploaded_bytes_400s(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/fourd-videos/", json={
        "project_id": str(project.id), "name": "sequence.webm", "duration_sec": 8.0,
        "storage_key": "fourd-videos/never-uploaded.webm",
    })
    assert resp.status_code == 400


async def test_download_video(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await upload_video(client, fake_object_storage, str(project.id), content=b"round-trip-video-bytes")).json()

    download_resp = await client.get(f"/api/v1/fourd-videos/{created['id']}/download")
    assert download_resp.status_code == 307
    assert fake_object_storage.read_url(download_resp.headers["location"]) == b"round-trip-video-bytes"


async def test_delete_video_removes_row_and_stored_object(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await upload_video(client, fake_object_storage, str(project.id))).json()

    del_resp = await client.delete(f"/api/v1/fourd-videos/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/fourd-videos/", params={"project_id": str(project.id)})).json()
    assert all(v["id"] != created["id"] for v in listing)
    assert fake_object_storage.objects == {}

    download_resp = await client.get(f"/api/v1/fourd-videos/{created['id']}/download")
    assert download_resp.status_code == 404


async def test_delete_unknown_video_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/fourd-videos/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_download_unknown_video_404s(client: AsyncClient, project: Project):
    resp = await client.get(f"/api/v1/fourd-videos/{uuid.uuid4()}/download")
    assert resp.status_code == 404


async def test_presign_derives_extension_from_content_type(client: AsyncClient, fake_object_storage: FakeObjectStorage):
    # 2026-07-25, per Maro: "can we get an mp4 rendering option" — the
    # stored object's extension follows the upload's own Content-Type
    # instead of always assuming webm.
    mp4 = (await client.post("/api/v1/fourd-videos/presign", json={"content_type": "video/mp4"})).json()
    webm = (await client.post("/api/v1/fourd-videos/presign", json={"content_type": "video/webm"})).json()
    assert mp4["storage_key"].endswith(".mp4")
    assert webm["storage_key"].endswith(".webm")


async def test_reuploading_same_name_does_not_replace(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    # Unlike Model3DFile, a second export under the same name is a
    # genuinely different capture (e.g. re-recording after fixing the
    # sequence) worth keeping alongside the first, not a re-import of "the
    # same model" — both rows survive.
    first = (await upload_video(client, fake_object_storage, str(project.id), content=b"version-one")).json()
    second = (await upload_video(client, fake_object_storage, str(project.id), content=b"version-two")).json()

    assert first["id"] != second["id"]

    listing = (await client.get("/api/v1/fourd-videos/", params={"project_id": str(project.id)})).json()
    ids = {v["id"] for v in listing}
    assert first["id"] in ids and second["id"] in ids
