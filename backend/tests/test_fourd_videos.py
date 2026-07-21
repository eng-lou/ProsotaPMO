from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


def upload_payload(project_id: str, name: str = "sequence.webm", duration_sec: float = 8.0, content: bytes = b"fake-webm-bytes"):
    data = {"project_id": project_id, "name": name, "duration_sec": str(duration_sec)}
    files = {"file": (name, content, "video/webm")}
    return data, files


async def test_upload_and_list_video(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id))
    resp = await client.post("/api/v1/fourd-videos/", data=data, files=files)
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "sequence.webm"
    assert created["duration_sec"] == 8.0
    assert created["size_bytes"] == len(b"fake-webm-bytes")

    listing = (await client.get("/api/v1/fourd-videos/", params={"project_id": str(project.id)})).json()
    assert any(v["id"] == created["id"] for v in listing)


async def test_upload_writes_to_disk(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id), content=b"hello-video-bytes")
    resp = await client.post("/api/v1/fourd-videos/", data=data, files=files)
    assert resp.status_code == 201, resp.text
    from app.services.fourd_video_storage import storage_dir
    matches = list(storage_dir().glob("*.webm"))
    assert any(p.read_bytes() == b"hello-video-bytes" for p in matches)


async def test_download_video(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id), content=b"round-trip-video-bytes")
    created = (await client.post("/api/v1/fourd-videos/", data=data, files=files)).json()

    download_resp = await client.get(f"/api/v1/fourd-videos/{created['id']}/download")
    assert download_resp.status_code == 200
    assert download_resp.content == b"round-trip-video-bytes"


async def test_delete_video_removes_row_and_disk_file(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id))
    created = (await client.post("/api/v1/fourd-videos/", data=data, files=files)).json()

    del_resp = await client.delete(f"/api/v1/fourd-videos/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/fourd-videos/", params={"project_id": str(project.id)})).json()
    assert all(v["id"] != created["id"] for v in listing)

    download_resp = await client.get(f"/api/v1/fourd-videos/{created['id']}/download")
    assert download_resp.status_code == 404


async def test_delete_unknown_video_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/fourd-videos/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_download_unknown_video_404s(client: AsyncClient, project: Project):
    resp = await client.get(f"/api/v1/fourd-videos/{uuid.uuid4()}/download")
    assert resp.status_code == 404


async def test_reuploading_same_name_does_not_replace(client: AsyncClient, project: Project):
    # Unlike Model3DFile, a second export under the same name is a
    # genuinely different capture (e.g. re-recording after fixing the
    # sequence) worth keeping alongside the first, not a re-import of "the
    # same model" — both rows survive.
    data, files = upload_payload(str(project.id), content=b"version-one")
    first = (await client.post("/api/v1/fourd-videos/", data=data, files=files)).json()

    data2, files2 = upload_payload(str(project.id), content=b"version-two")
    second = (await client.post("/api/v1/fourd-videos/", data=data2, files=files2)).json()

    assert first["id"] != second["id"]

    listing = (await client.get("/api/v1/fourd-videos/", params={"project_id": str(project.id)})).json()
    ids = {v["id"] for v in listing}
    assert first["id"] in ids and second["id"] in ids
