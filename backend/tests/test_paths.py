from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


def _points(n: int = 3) -> list[dict]:
    return [{"x": float(i), "y": 0.0, "z": 0.0} for i in range(n)]


async def test_create_and_list_path(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/paths/", json={"project_id": str(project.id), "points": _points()})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Path"
    assert created["closed"] is False
    assert created["visible"] is True
    assert len(created["points"]) == 3
    assert created["color"] == "#38bdf8"
    assert created["line_style"] == "solid"
    assert created["show_arrow"] is False
    assert created["show_label"] is False
    assert created["line_width"] == 2
    assert created["dash_size"] == 0.5
    assert created["gap_size"] == 0.3
    assert created["animate"] is False
    assert created["animation_loop"] is False

    listing = (await client.get("/api/v1/paths/", params={"project_id": str(project.id)})).json()
    assert any(p["id"] == created["id"] for p in listing)


async def test_style_path(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/paths/", json={"project_id": str(project.id), "points": _points(2)})).json()

    resp = await client.patch(f"/api/v1/paths/{created['id']}", json={
        "color": "#ef4444", "line_style": "dashed", "show_arrow": True, "show_label": True, "line_width": 5,
        "dash_size": 1.2, "gap_size": 0.6,
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["color"] == "#ef4444"
    assert updated["line_style"] == "dashed"
    assert updated["show_arrow"] is True
    assert updated["show_label"] is True
    assert updated["line_width"] == 5
    assert updated["dash_size"] == 1.2
    assert updated["gap_size"] == 0.6


async def test_animate_path(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/paths/", json={"project_id": str(project.id), "points": _points(2)})).json()

    resp = await client.patch(f"/api/v1/paths/{created['id']}", json={"animate": True, "animation_loop": True})
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["animate"] is True
    assert updated["animation_loop"] is True


async def test_animate_path_reveal_window_is_a_keyframe_pair(client: AsyncClient, project: Project):
    # The reveal window's own start/end (2026-07-30 rework, per Maro: "if i
    # keyframe i should see the path actor in the timeline with both
    # keyframes so i can drag, delete etc") live in element_keyframes, not
    # on the Path row itself — this confirms the same generic upsert route
    # every other animated actor already uses round-trips "anim_start"/
    # "anim_end" for source_kind="path" correctly.
    path = (await client.post("/api/v1/paths/", json={"project_id": str(project.id), "points": _points(2)})).json()

    start_resp = await client.post("/api/v1/element-keyframes/", json={
        "project_id": str(project.id), "source_kind": "path", "element_ref": path["id"],
        "field": "anim_start", "date": "2026-08-01T00:00:00Z", "value": 0,
    })
    end_resp = await client.post("/api/v1/element-keyframes/", json={
        "project_id": str(project.id), "source_kind": "path", "element_ref": path["id"],
        "field": "anim_end", "date": "2026-08-05T00:00:00Z", "value": 0,
    })
    assert start_resp.status_code == 201, start_resp.text
    assert end_resp.status_code == 201, end_resp.text

    listing = (await client.get("/api/v1/element-keyframes/", params={"project_id": str(project.id)})).json()
    own = [k for k in listing if k["source_kind"] == "path" and k["element_ref"] == path["id"]]
    assert {k["field"] for k in own} == {"anim_start", "anim_end"}


async def test_rewrite_points_and_toggle_closed(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/paths/", json={"project_id": str(project.id), "points": _points(2)})).json()

    resp = await client.patch(f"/api/v1/paths/{created['id']}", json={"points": _points(5), "closed": True})
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert len(updated["points"]) == 5
    assert updated["closed"] is True
    assert updated["name"] == "Path"  # untouched field stays as it was


async def test_update_unknown_path_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/paths/{uuid.uuid4()}", json={"name": "New Name"})
    assert resp.status_code == 404


async def test_delete_path(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/paths/", json={"project_id": str(project.id)})).json()

    del_resp = await client.delete(f"/api/v1/paths/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/paths/", params={"project_id": str(project.id)})).json()
    assert all(p["id"] != created["id"] for p in listing)


async def test_delete_unknown_path_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/paths/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_bind_and_list_follower(client: AsyncClient, project: Project):
    path = (await client.post("/api/v1/paths/", json={"project_id": str(project.id), "points": _points()})).json()

    resp = await client.put("/api/v1/path-followers/", json={
        "project_id": str(project.id), "path_id": path["id"], "target_kind": "mesh", "element_ref": "crane.glb",
    })
    assert resp.status_code == 200, resp.text
    follower = resp.json()
    assert follower["target_kind"] == "mesh"
    assert follower["element_ref"] == "crane.glb"
    assert follower["orient_to_path"] is True

    listing = (await client.get("/api/v1/path-followers/", params={"project_id": str(project.id)})).json()
    assert any(f["id"] == follower["id"] for f in listing)


async def test_rebinding_same_target_repoints_instead_of_duplicating(client: AsyncClient, project: Project):
    path_a = (await client.post("/api/v1/paths/", json={"project_id": str(project.id), "points": _points()})).json()
    path_b = (await client.post("/api/v1/paths/", json={"project_id": str(project.id), "points": _points()})).json()

    first = (await client.put("/api/v1/path-followers/", json={
        "project_id": str(project.id), "path_id": path_a["id"], "target_kind": "mesh", "element_ref": "crane.glb",
    })).json()
    second = (await client.put("/api/v1/path-followers/", json={
        "project_id": str(project.id), "path_id": path_b["id"], "target_kind": "mesh", "element_ref": "crane.glb",
    })).json()

    assert second["id"] == first["id"]
    assert second["path_id"] == path_b["id"]

    listing = (await client.get("/api/v1/path-followers/", params={"project_id": str(project.id)})).json()
    assert len([f for f in listing if f["element_ref"] == "crane.glb"]) == 1


async def test_camera_follower_uses_empty_element_ref(client: AsyncClient, project: Project):
    path = (await client.post("/api/v1/paths/", json={"project_id": str(project.id)})).json()

    resp = await client.put("/api/v1/path-followers/", json={
        "project_id": str(project.id), "path_id": path["id"], "target_kind": "camera",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["element_ref"] == ""


async def test_toggle_orient_to_path(client: AsyncClient, project: Project):
    path = (await client.post("/api/v1/paths/", json={"project_id": str(project.id)})).json()
    follower = (await client.put("/api/v1/path-followers/", json={
        "project_id": str(project.id), "path_id": path["id"], "target_kind": "mesh", "element_ref": "crane.glb",
    })).json()

    resp = await client.patch(f"/api/v1/path-followers/{follower['id']}", json={"orient_to_path": False})
    assert resp.status_code == 200, resp.text
    assert resp.json()["orient_to_path"] is False


async def test_delete_follower(client: AsyncClient, project: Project):
    path = (await client.post("/api/v1/paths/", json={"project_id": str(project.id)})).json()
    follower = (await client.put("/api/v1/path-followers/", json={
        "project_id": str(project.id), "path_id": path["id"], "target_kind": "mesh", "element_ref": "crane.glb",
    })).json()

    del_resp = await client.delete(f"/api/v1/path-followers/{follower['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/path-followers/", params={"project_id": str(project.id)})).json()
    assert all(f["id"] != follower["id"] for f in listing)


async def test_deleting_path_cascades_its_followers(client: AsyncClient, project: Project):
    path = (await client.post("/api/v1/paths/", json={"project_id": str(project.id)})).json()
    follower = (await client.put("/api/v1/path-followers/", json={
        "project_id": str(project.id), "path_id": path["id"], "target_kind": "mesh", "element_ref": "crane.glb",
    })).json()

    del_resp = await client.delete(f"/api/v1/paths/{path['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/path-followers/", params={"project_id": str(project.id)})).json()
    assert all(f["id"] != follower["id"] for f in listing)
