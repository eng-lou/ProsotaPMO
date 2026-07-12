from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


async def _create_model_file(client: AsyncClient, project: Project) -> str:
    data = {"project_id": str(project.id), "name": "tower.ifc", "kind": "ifc", "source_up_axis": "z"}
    files = {"file": ("tower.ifc", b"fake-ifc-bytes", "application/octet-stream")}
    resp = await client.post("/api/v1/model3d-files/", data=data, files=files)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _transform(**overrides) -> dict:
    payload = {
        "position_x": 10.0, "position_y": 0.0, "position_z": -5.0,
        "rotation_x": 0.0, "rotation_y": 1.5708, "rotation_z": 0.0,
        "scale_x": 1.0, "scale_y": 1.0, "scale_z": 1.0,
    }
    payload.update(overrides)
    return payload


async def test_save_and_list_whole_file_transform(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)

    resp = await client.post("/api/v1/element-transforms/", json={"model3d_file_id": file_id, **_transform()})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["element_ref"] is None
    assert created["position_x"] == 10.0
    assert created["project_id"] == str(project.id)

    listing = (await client.get("/api/v1/element-transforms/", params={"project_id": str(project.id)})).json()
    assert any(t["id"] == created["id"] for t in listing)


async def test_save_element_scoped_transform(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)

    resp = await client.post("/api/v1/element-transforms/", json={
        "model3d_file_id": file_id, "element_ref": "2O2Fr$t4X7Zf8NOew3FLOH", **_transform(position_x=99.0),
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["element_ref"] == "2O2Fr$t4X7Zf8NOew3FLOH"
    assert created["position_x"] == 99.0


async def test_saving_again_upserts_not_duplicates(client: AsyncClient, project: Project):
    # The whole point of this table: a gizmo drag or field edit just wants
    # "save wherever this is now" repeatedly, not a distinct create-then-
    # update flow the frontend has to track per target.
    file_id = await _create_model_file(client, project)

    first = (await client.post("/api/v1/element-transforms/", json={"model3d_file_id": file_id, **_transform(position_x=1.0)})).json()
    second = (await client.post("/api/v1/element-transforms/", json={"model3d_file_id": file_id, **_transform(position_x=2.0)})).json()

    assert first["id"] == second["id"]  # same row, updated in place
    assert second["position_x"] == 2.0

    listing = (await client.get("/api/v1/element-transforms/", params={"project_id": str(project.id)})).json()
    matching = [t for t in listing if t["model3d_file_id"] == file_id and t["element_ref"] is None]
    assert len(matching) == 1


async def test_whole_file_and_element_scoped_transforms_coexist(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)

    whole = (await client.post("/api/v1/element-transforms/", json={"model3d_file_id": file_id, **_transform(position_x=1.0)})).json()
    element = (await client.post("/api/v1/element-transforms/", json={
        "model3d_file_id": file_id, "element_ref": "SomeGlobalId123456", **_transform(position_x=2.0),
    })).json()

    assert whole["id"] != element["id"]
    listing = (await client.get("/api/v1/element-transforms/", params={"project_id": str(project.id)})).json()
    ids = {t["id"] for t in listing}
    assert whole["id"] in ids and element["id"] in ids


async def test_save_transform_unknown_model_file_404s(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/element-transforms/", json={"model3d_file_id": str(uuid.uuid4()), **_transform()})
    assert resp.status_code == 404


async def test_delete_transform(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)
    created = (await client.post("/api/v1/element-transforms/", json={"model3d_file_id": file_id, **_transform()})).json()

    del_resp = await client.delete(f"/api/v1/element-transforms/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/element-transforms/", params={"project_id": str(project.id)})).json()
    assert all(t["id"] != created["id"] for t in listing)


async def test_delete_unknown_transform_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/element-transforms/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_pivot_fields_default_null(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)
    created = (await client.post("/api/v1/element-transforms/", json={"model3d_file_id": file_id, **_transform()})).json()
    assert created["pivot_x"] is None
    assert created["pivot_y"] is None
    assert created["pivot_z"] is None


async def test_pivot_fields_round_trip_and_survive_unrelated_saves(client: AsyncClient, project: Project):
    # "Set Pivot" (2026-07-12) saves pivot_x/y/z alongside whatever
    # position/rotation/scale currently is; a later save that's really just
    # a gizmo drag on position must carry the same pivot forward rather
    # than silently clearing it back to null (see FourD.tsx's own
    # save-transform handler, which always re-sends the object's current
    # userData.pivot).
    file_id = await _create_model_file(client, project)

    with_pivot = (await client.post("/api/v1/element-transforms/", json={
        "model3d_file_id": file_id, **_transform(pivot_x=1.0, pivot_y=2.0, pivot_z=3.0),
    })).json()
    assert with_pivot["pivot_x"] == 1.0
    assert with_pivot["pivot_y"] == 2.0
    assert with_pivot["pivot_z"] == 3.0

    moved = (await client.post("/api/v1/element-transforms/", json={
        "model3d_file_id": file_id, **_transform(position_x=42.0, pivot_x=1.0, pivot_y=2.0, pivot_z=3.0),
    })).json()
    assert moved["id"] == with_pivot["id"]
    assert moved["position_x"] == 42.0
    assert moved["pivot_x"] == 1.0
    assert moved["pivot_y"] == 2.0
    assert moved["pivot_z"] == 3.0


async def test_deleting_model_file_cascades_its_transforms(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)
    created = (await client.post("/api/v1/element-transforms/", json={"model3d_file_id": file_id, **_transform()})).json()

    del_resp = await client.delete(f"/api/v1/model3d-files/{file_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/element-transforms/", params={"project_id": str(project.id)})).json()
    assert all(t["id"] != created["id"] for t in listing)
