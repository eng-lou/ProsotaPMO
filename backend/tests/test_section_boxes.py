from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


async def _create_model_file(client: AsyncClient, project: Project, kind: str = "ifc") -> str:
    data = {"project_id": str(project.id), "name": "tower.ifc", "kind": kind, "source_up_axis": "z"}
    files = {"file": ("tower.ifc", b"fake-ifc-bytes", "application/octet-stream")}
    resp = await client.post("/api/v1/model3d-files/", data=data, files=files)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _bounds(**overrides) -> dict:
    payload = {"min_x": -1.0, "min_y": -1.0, "min_z": -1.0, "max_x": 1.0, "max_y": 1.0, "max_z": 1.0}
    payload.update(overrides)
    return payload


async def test_create_and_list_whole_model_box(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)

    resp = await client.post("/api/v1/section-boxes/", json={"model3d_file_id": file_id, **_bounds()})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Section Box"
    assert created["element_ref"] is None
    assert created["project_id"] == str(project.id)
    assert created["active"] is True
    assert created["visible"] is True

    listing = (await client.get("/api/v1/section-boxes/", params={"project_id": str(project.id)})).json()
    assert any(b["id"] == created["id"] for b in listing)


async def test_create_element_scoped_box(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)

    resp = await client.post("/api/v1/section-boxes/", json={
        "model3d_file_id": file_id, "element_ref": "2O2Fr$t4X7Zf8NOew3FLOH", "name": "Cross Section Slab", **_bounds(),
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["element_ref"] == "2O2Fr$t4X7Zf8NOew3FLOH"
    assert created["name"] == "Cross Section Slab"


async def test_create_box_unknown_model_file_404s(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/section-boxes/", json={"model3d_file_id": str(uuid.uuid4()), **_bounds()})
    assert resp.status_code == 404


async def test_rename_and_toggle_box(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)
    created = (await client.post("/api/v1/section-boxes/", json={"model3d_file_id": file_id, **_bounds()})).json()

    resp = await client.patch(f"/api/v1/section-boxes/{created['id']}", json={"name": "West Wing Cut", "active": False})
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["name"] == "West Wing Cut"
    assert updated["active"] is False
    assert updated["visible"] is True  # untouched fields stay as they were


async def test_drag_face_updates_bounds(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)
    created = (await client.post("/api/v1/section-boxes/", json={"model3d_file_id": file_id, **_bounds()})).json()

    resp = await client.patch(f"/api/v1/section-boxes/{created['id']}", json={"min_x": 0.25})
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["min_x"] == 0.25
    assert updated["max_x"] == 1.0  # sibling bounds untouched


async def test_update_unknown_box_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/section-boxes/{uuid.uuid4()}", json={"name": "New Name"})
    assert resp.status_code == 404


async def test_delete_box(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)
    created = (await client.post("/api/v1/section-boxes/", json={"model3d_file_id": file_id, **_bounds()})).json()

    del_resp = await client.delete(f"/api/v1/section-boxes/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/section-boxes/", params={"project_id": str(project.id)})).json()
    assert all(b["id"] != created["id"] for b in listing)


async def test_delete_unknown_box_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/section-boxes/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_deleting_model_file_cascades_its_section_boxes(client: AsyncClient, project: Project):
    file_id = await _create_model_file(client, project)
    created = (await client.post("/api/v1/section-boxes/", json={"model3d_file_id": file_id, **_bounds()})).json()

    del_resp = await client.delete(f"/api/v1/model3d-files/{file_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/section-boxes/", params={"project_id": str(project.id)})).json()
    assert all(b["id"] != created["id"] for b in listing)
