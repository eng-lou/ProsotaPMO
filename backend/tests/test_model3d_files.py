from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.models.project import Project
from tests.conftest import FakeObjectStorage

pytestmark = pytest.mark.usefixtures("fake_object_storage")


# Direct-to-R2 upload flow (2026-08-23, 51e97fc): presign, PUT the bytes to
# the returned url, then register the storage_key with the JSON create call.
async def upload_file(
    client: AsyncClient, storage: FakeObjectStorage, project_id: str, name: str = "tower.ifc", kind: str = "ifc",
    axis: str = "z", content: bytes = b"fake-ifc-bytes", **extra,
):
    storage_key = await storage.presign_and_put(client, "/api/v1/model3d-files/presign", content, name=name)
    return await client.post("/api/v1/model3d-files/", json={
        "project_id": project_id, "name": name, "kind": kind, "source_up_axis": axis, "storage_key": storage_key, **extra,
    })


async def test_upload_and_list_file(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    resp = await upload_file(client, fake_object_storage, str(project.id))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "tower.ifc"
    assert created["kind"] == "ifc"
    assert created["source_up_axis"] == "z"
    assert created["size_bytes"] == len(b"fake-ifc-bytes")

    listing = (await client.get("/api/v1/model3d-files/", params={"project_id": str(project.id)})).json()
    assert any(f["id"] == created["id"] for f in listing)


async def test_upload_defaults_keep_raw_animation_false(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    resp = await upload_file(client, fake_object_storage, str(project.id))
    assert resp.json()["keep_raw_animation"] is False


async def test_upload_keep_raw_animation_true_round_trips(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    """The Water Spray.glb case (2026-08-22): a particle-VFX import whose
    animation can't become schedule keyframes gets uploaded with
    keep_raw_animation set, so the restore-on-mount path (FourD.tsx) knows
    to keep the raw clip instead of stripping it on every reload."""
    resp = await upload_file(
        client, fake_object_storage, str(project.id), name="water_spray.glb", kind="mesh", axis="y", keep_raw_animation=True,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["keep_raw_animation"] is True

    listing = (await client.get("/api/v1/model3d-files/", params={"project_id": str(project.id)})).json()
    found = next(f for f in listing if f["name"] == "water_spray.glb")
    assert found["keep_raw_animation"] is True


async def test_register_without_uploaded_bytes_400s(client: AsyncClient, project: Project):
    # The upload never reached storage (failed/expired presigned PUT).
    resp = await client.post("/api/v1/model3d-files/", json={
        "project_id": str(project.id), "name": "tower.ifc", "kind": "ifc", "source_up_axis": "z",
        "storage_key": "model3d/never-uploaded.ifc",
    })
    assert resp.status_code == 400


async def test_download_file(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await upload_file(client, fake_object_storage, str(project.id), content=b"round-trip-bytes")).json()

    download_resp = await client.get(f"/api/v1/model3d-files/{created['id']}/download")
    assert download_resp.status_code == 307
    assert fake_object_storage.read_url(download_resp.headers["location"]) == b"round-trip-bytes"


async def test_delete_file_removes_row_and_stored_object(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    created = (await upload_file(client, fake_object_storage, str(project.id))).json()
    assert len(fake_object_storage.objects) == 1

    del_resp = await client.delete(f"/api/v1/model3d-files/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/model3d-files/", params={"project_id": str(project.id)})).json()
    assert all(f["id"] != created["id"] for f in listing)
    assert fake_object_storage.objects == {}

    download_resp = await client.get(f"/api/v1/model3d-files/{created['id']}/download")
    assert download_resp.status_code == 404


async def test_delete_unknown_file_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/model3d-files/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_download_unknown_file_404s(client: AsyncClient, project: Project):
    resp = await client.get(f"/api/v1/model3d-files/{uuid.uuid4()}/download")
    assert resp.status_code == 404


async def test_reimporting_same_name_replaces_not_accumulates(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    # Real incident (2026-07-11): the frontend's restore-on-mount was slow/
    # unreliable enough that a user re-imported the same file 5 times
    # across one day, leaving 5 full duplicate copies in the database and
    # in storage. Re-importing a file with the same name/kind must replace
    # the prior row, not pile up alongside it.
    first = (await upload_file(client, fake_object_storage, str(project.id), content=b"version-one")).json()
    second = (await upload_file(client, fake_object_storage, str(project.id), content=b"version-two")).json()

    assert first["id"] != second["id"]  # a genuinely new row, not an in-place update

    listing = (await client.get("/api/v1/model3d-files/", params={"project_id": str(project.id)})).json()
    matching = [f for f in listing if f["name"] == "tower.ifc"]
    assert len(matching) == 1, f"expected exactly one 'tower.ifc' row, found {len(matching)}"
    assert matching[0]["id"] == second["id"]

    # The old row and its stored object are both gone.
    old_download = await client.get(f"/api/v1/model3d-files/{first['id']}/download")
    assert old_download.status_code == 404
    assert list(fake_object_storage.objects.values()) == [b"version-two"]

    new_download = await client.get(f"/api/v1/model3d-files/{second['id']}/download")
    assert new_download.status_code == 307
    assert fake_object_storage.read_url(new_download.headers["location"]) == b"version-two"


async def test_reimporting_different_name_does_not_replace(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    tower = (await upload_file(client, fake_object_storage, str(project.id), name="tower.ifc")).json()
    annex = (await upload_file(client, fake_object_storage, str(project.id), name="annex.ifc")).json()

    listing = (await client.get("/api/v1/model3d-files/", params={"project_id": str(project.id)})).json()
    ids = {f["id"] for f in listing}
    assert tower["id"] in ids and annex["id"] in ids  # both survive -- different names, not a re-import of the same file


async def test_unloaded_elements_defaults_empty_and_round_trips(client: AsyncClient, project: Project, fake_object_storage: FakeObjectStorage):
    # "Unload Selected"/"Reload IFC" (2026-07-26, per Maro: "if i refresh, i
    # expect the elements i unloaded to stay unloaded").
    created = (await upload_file(client, fake_object_storage, str(project.id))).json()
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
