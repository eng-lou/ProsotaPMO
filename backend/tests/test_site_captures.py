from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

import numpy as np
import pye57
import pytest
from httpx import AsyncClient

from app.models.project import Project
from tests.conftest import FakeObjectStorage

pytestmark = pytest.mark.usefixtures("fake_object_storage")


# Direct-to-R2 upload flow (2026-08-23, 51e97fc): presign, PUT the bytes to
# the returned url, then register the storage_key with the JSON create call.
async def upload_capture(
    client: AsyncClient, storage: FakeObjectStorage, project_id: str, name: str = "cloud.xyz",
    captured_at: str = "2026-08-15", kind: str = "xyz", axis: str = "y",
    content: bytes = b"-21.7 -3.3 1.4 77 33 34\n",
):
    storage_key = await storage.presign_and_put(client, "/api/v1/site-captures/presign", content, name=name)
    return await client.post("/api/v1/site-captures/", json={
        "project_id": project_id, "name": name, "captured_at": captured_at, "kind": kind, "source_up_axis": axis,
        "storage_key": storage_key,
    })


async def _download(client: AsyncClient, storage: FakeObjectStorage, capture_id: str) -> bytes:
    resp = await client.get(f"/api/v1/site-captures/{capture_id}/download")
    assert resp.status_code == 307, resp.text
    return storage.read_url(resp.headers["location"])


# A real, valid (if tiny) .e57 file, built with pye57's own writer rather
# than hand-crafted bytes — see e57_convert.py's own conversion function
# this exercises end-to-end (upload -> POST .../convert -> download),
# genuinely round-tripping through the real libE57Format binding on both
# ends, not a mocked stand-in for one.
def _build_synthetic_e57_bytes() -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "synthetic.e57"
        data_raw = {
            "cartesianX": np.array([1.0, 2.0, 3.0], dtype=np.float64),
            "cartesianY": np.array([4.0, 5.0, 6.0], dtype=np.float64),
            "cartesianZ": np.array([7.0, 8.0, 9.0], dtype=np.float64),
            "colorRed": np.array([10, 20, 30], dtype=np.uint8),
            "colorGreen": np.array([40, 50, 60], dtype=np.uint8),
            "colorBlue": np.array([70, 80, 90], dtype=np.uint8),
        }
        with pye57.E57(str(path), mode="w") as writer:
            writer.write_scan_raw(data_raw)
        return path.read_bytes()


async def test_upload_and_list_capture(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    resp = await upload_capture(client, fake_object_storage, str(project.id))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "cloud.xyz"
    assert created["captured_at"] == "2026-08-15"
    assert created["kind"] == "xyz"
    assert created["source_up_axis"] == "y"
    assert created["force_visible"] is False
    assert created["size_bytes"] == len(b"-21.7 -3.3 1.4 77 33 34\n")

    listing = (await client.get("/api/v1/site-captures/", params={"project_id": str(project.id)})).json()
    assert any(c["id"] == created["id"] for c in listing)


async def test_register_without_uploaded_bytes_400s(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/site-captures/", json={
        "project_id": str(project.id), "name": "cloud.xyz", "captured_at": "2026-08-15", "kind": "xyz",
        "source_up_axis": "y", "storage_key": "site-captures/never-uploaded.xyz",
    })
    assert resp.status_code == 400


async def test_download_capture(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await upload_capture(client, fake_object_storage, str(project.id), content=b"round-trip-bytes")).json()

    assert await _download(client, fake_object_storage, created["id"]) == b"round-trip-bytes"


async def test_delete_capture_removes_row_and_stored_object(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await upload_capture(client, fake_object_storage, str(project.id))).json()

    del_resp = await client.delete(f"/api/v1/site-captures/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/site-captures/", params={"project_id": str(project.id)})).json()
    assert all(c["id"] != created["id"] for c in listing)
    assert fake_object_storage.objects == {}

    download_resp = await client.get(f"/api/v1/site-captures/{created['id']}/download")
    assert download_resp.status_code == 404


async def test_delete_unknown_capture_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/site-captures/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_download_unknown_capture_404s(client: AsyncClient, project: Project):
    resp = await client.get(f"/api/v1/site-captures/{uuid.uuid4()}/download")
    assert resp.status_code == 404


async def test_reimporting_same_name_does_not_replace(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    # Unlike Model3DFile, a SiteCapture is a dated snapshot -- a project can
    # (and should) have many captures over time, so uploading the same name
    # twice must NOT delete the earlier one the way Model3DFile's re-import
    # convention does.
    first = (await upload_capture(client, fake_object_storage, str(project.id), captured_at="2026-08-01", content=b"version-one")).json()

    second = (await upload_capture(client, fake_object_storage, str(project.id), captured_at="2026-08-15", content=b"version-two")).json()

    assert first["id"] != second["id"]

    listing = (await client.get("/api/v1/site-captures/", params={"project_id": str(project.id)})).json()
    matching = [c for c in listing if c["name"] == "cloud.xyz"]
    assert len(matching) == 2

    assert await _download(client, fake_object_storage, first["id"]) == b"version-one"


async def test_update_capture_metadata(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await upload_capture(client, fake_object_storage, str(project.id))).json()

    patch_resp = await client.patch(
        f"/api/v1/site-captures/{created['id']}",
        json={"name": "Level 2 Slab Scan", "captured_at": "2026-08-16", "force_visible": True},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    updated = patch_resp.json()
    assert updated["name"] == "Level 2 Slab Scan"
    assert updated["captured_at"] == "2026-08-16"
    assert updated["force_visible"] is True

    # Partial update -- unspecified fields are left untouched.
    patch_resp2 = await client.patch(f"/api/v1/site-captures/{created['id']}", json={"force_visible": False})
    assert patch_resp2.json()["name"] == "Level 2 Slab Scan"
    assert patch_resp2.json()["force_visible"] is False


async def test_update_unknown_capture_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/site-captures/{uuid.uuid4()}", json={"name": "x"})
    assert resp.status_code == 404


async def test_list_orders_by_captured_at(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    await upload_capture(client, fake_object_storage, str(project.id), name="later.xyz", captured_at="2026-08-20")
    await upload_capture(client, fake_object_storage, str(project.id), name="earlier.xyz", captured_at="2026-08-01")

    listing = (await client.get("/api/v1/site-captures/", params={"project_id": str(project.id)})).json()
    names = [c["name"] for c in listing]
    assert names.index("earlier.xyz") < names.index("later.xyz")


async def test_convert_e57_capture_to_xyz(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    e57_bytes = _build_synthetic_e57_bytes()
    created = (await upload_capture(client, fake_object_storage, str(project.id), name="scan.e57", kind="e57", content=e57_bytes)).json()
    assert created["kind"] == "e57"

    resp = await client.post(f"/api/v1/site-captures/{created['id']}/convert")
    assert resp.status_code == 200, resp.text
    converted = resp.json()
    assert converted["kind"] == "xyz"
    assert converted["id"] == created["id"]

    lines = (await _download(client, fake_object_storage, created["id"])).decode().strip().splitlines()
    assert len(lines) == 3
    assert lines[0].split() == ["1.000000", "4.000000", "7.000000", "10", "40", "70"]


async def test_convert_non_e57_capture_400s(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await upload_capture(client, fake_object_storage, str(project.id))).json()
    assert created["kind"] == "xyz"

    resp = await client.post(f"/api/v1/site-captures/{created['id']}/convert")
    assert resp.status_code == 400


async def test_convert_unknown_capture_404s(client: AsyncClient, project: Project):
    resp = await client.post(f"/api/v1/site-captures/{uuid.uuid4()}/convert")
    assert resp.status_code == 404
