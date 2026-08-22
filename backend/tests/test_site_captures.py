from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

import numpy as np
import pye57
from httpx import AsyncClient

from app.models.project import Project


def upload_payload(
    project_id: str, name: str = "cloud.xyz", captured_at: str = "2026-08-15",
    kind: str = "xyz", axis: str = "y", content: bytes = b"-21.7 -3.3 1.4 77 33 34\n",
):
    data = {"project_id": project_id, "name": name, "captured_at": captured_at, "kind": kind, "source_up_axis": axis}
    files = {"file": (name, content, "application/octet-stream")}
    return data, files


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


async def test_upload_and_list_capture(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id))
    resp = await client.post("/api/v1/site-captures/", data=data, files=files)
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


async def test_upload_writes_to_disk(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id), content=b"hello-world-bytes")
    resp = await client.post("/api/v1/site-captures/", data=data, files=files)
    assert resp.status_code == 201, resp.text
    from app.services.site_capture_storage import storage_dir
    matches = list(storage_dir().glob("*.xyz"))
    assert any(p.read_bytes() == b"hello-world-bytes" for p in matches)


async def test_download_capture(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id), content=b"round-trip-bytes")
    created = (await client.post("/api/v1/site-captures/", data=data, files=files)).json()

    download_resp = await client.get(f"/api/v1/site-captures/{created['id']}/download")
    assert download_resp.status_code == 200
    assert download_resp.content == b"round-trip-bytes"


async def test_delete_capture_removes_row_and_disk_file(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id))
    created = (await client.post("/api/v1/site-captures/", data=data, files=files)).json()

    del_resp = await client.delete(f"/api/v1/site-captures/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/site-captures/", params={"project_id": str(project.id)})).json()
    assert all(c["id"] != created["id"] for c in listing)

    download_resp = await client.get(f"/api/v1/site-captures/{created['id']}/download")
    assert download_resp.status_code == 404


async def test_delete_unknown_capture_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/site-captures/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_download_unknown_capture_404s(client: AsyncClient, project: Project):
    resp = await client.get(f"/api/v1/site-captures/{uuid.uuid4()}/download")
    assert resp.status_code == 404


async def test_reimporting_same_name_does_not_replace(client: AsyncClient, project: Project):
    # Unlike Model3DFile, a SiteCapture is a dated snapshot -- a project can
    # (and should) have many captures over time, so uploading the same name
    # twice must NOT delete the earlier one the way Model3DFile's re-import
    # convention does.
    data, files = upload_payload(str(project.id), captured_at="2026-08-01", content=b"version-one")
    first = (await client.post("/api/v1/site-captures/", data=data, files=files)).json()

    data2, files2 = upload_payload(str(project.id), captured_at="2026-08-15", content=b"version-two")
    second = (await client.post("/api/v1/site-captures/", data=data2, files=files2)).json()

    assert first["id"] != second["id"]

    listing = (await client.get("/api/v1/site-captures/", params={"project_id": str(project.id)})).json()
    matching = [c for c in listing if c["name"] == "cloud.xyz"]
    assert len(matching) == 2

    first_download = await client.get(f"/api/v1/site-captures/{first['id']}/download")
    assert first_download.status_code == 200
    assert first_download.content == b"version-one"


async def test_update_capture_metadata(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id))
    created = (await client.post("/api/v1/site-captures/", data=data, files=files)).json()

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


async def test_list_orders_by_captured_at(client: AsyncClient, project: Project):
    data1, files1 = upload_payload(str(project.id), name="later.xyz", captured_at="2026-08-20")
    await client.post("/api/v1/site-captures/", data=data1, files=files1)
    data2, files2 = upload_payload(str(project.id), name="earlier.xyz", captured_at="2026-08-01")
    await client.post("/api/v1/site-captures/", data=data2, files=files2)

    listing = (await client.get("/api/v1/site-captures/", params={"project_id": str(project.id)})).json()
    names = [c["name"] for c in listing]
    assert names.index("earlier.xyz") < names.index("later.xyz")


async def test_convert_e57_capture_to_xyz(client: AsyncClient, project: Project):
    e57_bytes = _build_synthetic_e57_bytes()
    data, files = upload_payload(str(project.id), name="scan.e57", kind="e57", content=e57_bytes)
    created = (await client.post("/api/v1/site-captures/", data=data, files=files)).json()
    assert created["kind"] == "e57"

    resp = await client.post(f"/api/v1/site-captures/{created['id']}/convert")
    assert resp.status_code == 200, resp.text
    converted = resp.json()
    assert converted["kind"] == "xyz"
    assert converted["id"] == created["id"]

    download = await client.get(f"/api/v1/site-captures/{created['id']}/download")
    assert download.status_code == 200
    lines = download.content.decode().strip().splitlines()
    assert len(lines) == 3
    assert lines[0].split() == ["1.000000", "4.000000", "7.000000", "10", "40", "70"]


async def test_convert_non_e57_capture_400s(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id))
    created = (await client.post("/api/v1/site-captures/", data=data, files=files)).json()
    assert created["kind"] == "xyz"

    resp = await client.post(f"/api/v1/site-captures/{created['id']}/convert")
    assert resp.status_code == 400


async def test_convert_unknown_capture_404s(client: AsyncClient, project: Project):
    resp = await client.post(f"/api/v1/site-captures/{uuid.uuid4()}/convert")
    assert resp.status_code == 404
