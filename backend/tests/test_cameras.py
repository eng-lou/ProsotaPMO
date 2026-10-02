from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project

POSE = {
    "base_position_x": 10, "base_position_y": -10, "base_position_z": 5,
    "base_target_x": 0, "base_target_y": 0, "base_target_z": 0,
}


async def _camera(client: AsyncClient, project: Project, name: str) -> str:
    resp = await client.post("/api/v1/cameras/", json={"project_id": str(project.id), "name": name, **POSE})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _key(client: AsyncClient, project: Project, camera_id: str, field: str) -> None:
    resp = await client.post("/api/v1/element-keyframes/", json={
        "project_id": str(project.id), "source_kind": "camera", "element_ref": camera_id,
        "field": field, "date": "2026-10-19T00:00:00Z", "value": 1.0,
    })
    assert resp.status_code == 201, resp.text


async def test_delete_camera_removes_only_its_keyframes(client: AsyncClient, project: Project):
    # 2026-10-02, per Maro: deleting a camera left its keyframe track behind
    # in the Animation Timeline — element_keyframes has no FK to cameras.
    doomed = await _camera(client, project, "Shot A")
    kept = await _camera(client, project, "Shot B")
    for field in ("pos_x", "target_x", "focal_length"):
        await _key(client, project, doomed, field)
    await _key(client, project, kept, "pos_x")

    resp = await client.delete(f"/api/v1/cameras/{doomed}")
    assert resp.status_code == 204, resp.text

    remaining = (await client.get("/api/v1/element-keyframes/", params={"project_id": str(project.id)})).json()
    refs = {k["element_ref"] for k in remaining if k["source_kind"] == "camera"}
    assert doomed not in refs
    assert kept in refs
