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


async def test_reimporting_same_name_replaces_not_accumulates(client: AsyncClient, project: Project):
    # Real incident (2026-07-11): the frontend's restore-on-mount was slow/
    # unreliable enough that a user re-imported the same file 5 times
    # across one day, leaving 5 full duplicate copies in the database and
    # on disk. Re-importing a file with the same name/kind must replace
    # the prior row, not pile up alongside it.
    data, files = upload_payload(str(project.id), content=b"version-one")
    first = (await client.post("/api/v1/model3d-files/", data=data, files=files)).json()

    data2, files2 = upload_payload(str(project.id), content=b"version-two")
    second = (await client.post("/api/v1/model3d-files/", data=data2, files=files2)).json()

    assert first["id"] != second["id"]  # a genuinely new row, not an in-place update

    listing = (await client.get("/api/v1/model3d-files/", params={"project_id": str(project.id)})).json()
    matching = [f for f in listing if f["name"] == "tower.ifc"]
    assert len(matching) == 1, f"expected exactly one 'tower.ifc' row, found {len(matching)}"
    assert matching[0]["id"] == second["id"]

    # The old row's own id is gone -- both the DB row and its disk file.
    old_download = await client.get(f"/api/v1/model3d-files/{first['id']}/download")
    assert old_download.status_code == 404

    new_download = await client.get(f"/api/v1/model3d-files/{second['id']}/download")
    assert new_download.status_code == 200
    assert new_download.content == b"version-two"


async def test_reimporting_different_name_does_not_replace(client: AsyncClient, project: Project):
    data, files = upload_payload(str(project.id), name="tower.ifc")
    tower = (await client.post("/api/v1/model3d-files/", data=data, files=files)).json()

    data2, files2 = upload_payload(str(project.id), name="annex.ifc")
    annex = (await client.post("/api/v1/model3d-files/", data=data2, files=files2)).json()

    listing = (await client.get("/api/v1/model3d-files/", params={"project_id": str(project.id)})).json()
    ids = {f["id"] for f in listing}
    assert tower["id"] in ids and annex["id"] in ids  # both survive -- different names, not a re-import of the same file


async def test_unloaded_elements_defaults_empty_and_round_trips(client: AsyncClient, project: Project):
    # "Unload Selected"/"Reload IFC" (2026-07-26, per Maro: "if i refresh, i
    # expect the elements i unloaded to stay unloaded").
    data, files = upload_payload(str(project.id))
    created = (await client.post("/api/v1/model3d-files/", data=data, files=files)).json()
    assert created["unloaded_elements"] is None

    elements = [
        {"guid": "2FEbCL3SD6jBrcV_5oCbiC", "name": "Wall-01", "type_name": "IfcWallStandardCase"},
        {"guid": "3GFcDM4TE7kCsdW_6pDciD", "name": "Slab-04", "type_name": "IfcSlab"},
    ]
    patch_resp = await client.patch(
        f"/api/v1/model3d-files/{created['id']}/unloaded-elements", json={"unloaded_elements": elements},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    assert patch_resp.json()["unloaded_elements"] == elements

    listing = (await client.get("/api/v1/model3d-files/", params={"project_id": str(project.id)})).json()
    match = next(f for f in listing if f["id"] == created["id"])
    assert match["unloaded_elements"] == elements

    # A later call fully replaces the list, not appends to it (matches the
    # frontend's own "always send the full current state" convention).
    replace_resp = await client.patch(
        f"/api/v1/model3d-files/{created['id']}/unloaded-elements", json={"unloaded_elements": elements[:1]},
    )
    assert replace_resp.json()["unloaded_elements"] == elements[:1]


async def test_update_unloaded_elements_unknown_file_404s(client: AsyncClient, project: Project):
    resp = await client.patch(
        f"/api/v1/model3d-files/{uuid.uuid4()}/unloaded-elements", json={"unloaded_elements": []},
    )
    assert resp.status_code == 404
