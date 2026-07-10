from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


def upload_payload(project_id: str, name: str = "tower.ifc", kind: str = "ifc", axis: str = "z", content: bytes = b"fake-ifc-bytes"):
    data = {"project_id": project_id, "name": name, "kind": kind, "source_up_axis": axis}
    files = {"file": (name, content, "application/octet-stream")}
    return data, files


async def test_upload_and_list_file(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id))
    resp = await client.post("/api/v1/model3d-files/", data=data, files=files)
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "tower.ifc"
    assert created["kind"] == "ifc"
    assert created["source_up_axis"] == "z"
    assert created["size_bytes"] == len(b"fake-ifc-bytes")

    listing = (await client.get("/api/v1/model3d-files/", params={"project_id": str(project.id)})).json()
    assert any(f["id"] == created["id"] for f in listing)


async def test_upload_writes_to_disk(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id), content=b"hello-world-bytes")
    resp = await client.post("/api/v1/model3d-files/", data=data, files=files)
    assert resp.status_code == 201, resp.text
    from app.services.model3d_storage import storage_dir
    matches = list(storage_dir().glob("*.ifc"))
    assert any(p.read_bytes() == b"hello-world-bytes" for p in matches)


async def test_download_file(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id), content=b"round-trip-bytes")
    created = (await client.post("/api/v1/model3d-files/", data=data, files=files)).json()

    download_resp = await client.get(f"/api/v1/model3d-files/{created['id']}/download")
    assert download_resp.status_code == 200
    assert download_resp.content == b"round-trip-bytes"


async def test_delete_file_removes_row_and_disk_file(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id))
    created = (await client.post("/api/v1/model3d-files/", data=data, files=files)).json()

    del_resp = await client.delete(f"/api/v1/model3d-files/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/model3d-files/", params={"project_id": str(project.id)})).json()
    assert all(f["id"] != created["id"] for f in listing)

    # storage_filename isn't in the response schema, so a download 404ing
    # is the observable proof both the row and the disk file are gone.
    download_resp = await client.get(f"/api/v1/model3d-files/{created['id']}/download")
    assert download_resp.status_code == 404


async def test_delete_unknown_file_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/model3d-files/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_download_unknown_file_404s(client: AsyncClient, project: Project):
    resp = await client.get(f"/api/v1/model3d-files/{uuid.uuid4()}/download")
    assert resp.status_code == 404
