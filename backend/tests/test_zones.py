from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


def _points(n: int = 4) -> list[dict]:
    return [{"x": float(i), "y": 0.0, "z": float(i * 2)} for i in range(n)]


async def test_create_and_list_zone(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/zones/", json={"project_id": str(project.id), "points": _points()})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Zone"
    assert created["elevation"] == 0.0
    assert created["fill_color"] == "#ef4444"
    assert created["fill_opacity"] == 0.35
    assert created["border_color"] == "#ffffff"
    assert created["border_width"] == 2
    assert created["border_style"] == "solid"
    assert created["border_dash_size"] == 0.5
    assert created["border_gap_size"] == 0.3
    assert created["visible"] is True
    assert created["animate"] is False
    assert created["animation_loop"] is False
    assert created["animation_mode"] == "draw"
    assert created["shape"] == "polygon"
    assert created["radius"] == 5.0
    assert len(created["points"]) == 4

    listing = (await client.get("/api/v1/zones/", params={"project_id": str(project.id)})).json()
    assert any(z["id"] == created["id"] for z in listing)


async def test_create_circle_zone(client: AsyncClient, project: Project):
    # Radial/clearance zone (2026-07-30, per Maro: "the radial zone for
    # things like crane clearance etc") — shape="circle" stores exactly
    # one point (the center) plus radius; a real caller (ZonesPanel.tsx's
    # own "+ Circle" button) always sends both together.
    resp = await client.post("/api/v1/zones/", json={
        "project_id": str(project.id), "shape": "circle", "points": [{"x": 3.0, "y": 0.0, "z": 4.0}], "radius": 8.0,
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["shape"] == "circle"
    assert created["radius"] == 8.0
    assert len(created["points"]) == 1


async def test_update_zone_radius(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/zones/", json={
        "project_id": str(project.id), "shape": "circle", "points": [{"x": 0.0, "y": 0.0, "z": 0.0}],
    })).json()

    resp = await client.patch(f"/api/v1/zones/{created['id']}", json={"radius": 12.5})
    assert resp.status_code == 200, resp.text
    assert resp.json()["radius"] == 12.5


async def test_zone_radius_must_be_positive(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/zones/", json={"project_id": str(project.id), "radius": 0})
    assert resp.status_code == 422


async def test_rewrite_points_and_style(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/zones/", json={"project_id": str(project.id), "points": _points(3)})).json()

    resp = await client.patch(f"/api/v1/zones/{created['id']}", json={
        "points": _points(5), "elevation": 12.5, "fill_color": "#22c55e", "fill_opacity": 0.6, "border_width": 6,
        "border_style": "dashed", "border_dash_size": 0.8, "border_gap_size": 0.4,
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert len(updated["points"]) == 5
    assert updated["elevation"] == 12.5
    assert updated["fill_color"] == "#22c55e"
    assert updated["fill_opacity"] == 0.6
    assert updated["border_width"] == 6
    assert updated["border_style"] == "dashed"
    assert updated["border_dash_size"] == 0.8
    assert updated["border_gap_size"] == 0.4
    assert updated["name"] == "Zone"  # untouched field stays as it was


async def test_animate_zone(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/zones/", json={"project_id": str(project.id), "points": _points(3)})).json()

    resp = await client.patch(f"/api/v1/zones/{created['id']}", json={
        "animate": True, "animation_loop": True, "animation_mode": "flash",
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["animate"] is True
    assert updated["animation_loop"] is True
    assert updated["animation_mode"] == "flash"


async def test_animate_zone_reveal_window_is_a_keyframe_pair(client: AsyncClient, project: Project):
    # Same rework as Path's own matching test — see test_paths.py's own
    # test_animate_path_reveal_window_is_a_keyframe_pair header.
    zone = (await client.post("/api/v1/zones/", json={"project_id": str(project.id), "points": _points(3)})).json()

    start_resp = await client.post("/api/v1/element-keyframes/", json={
        "project_id": str(project.id), "source_kind": "zone", "element_ref": zone["id"],
        "field": "anim_start", "date": "2026-08-01T00:00:00Z", "value": 0,
    })
    end_resp = await client.post("/api/v1/element-keyframes/", json={
        "project_id": str(project.id), "source_kind": "zone", "element_ref": zone["id"],
        "field": "anim_end", "date": "2026-08-05T00:00:00Z", "value": 0,
    })
    assert start_resp.status_code == 201, start_resp.text
    assert end_resp.status_code == 201, end_resp.text

    listing = (await client.get("/api/v1/element-keyframes/", params={"project_id": str(project.id)})).json()
    own = [k for k in listing if k["source_kind"] == "zone" and k["element_ref"] == zone["id"]]
    assert {k["field"] for k in own} == {"anim_start", "anim_end"}


async def test_update_unknown_zone_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/zones/{uuid.uuid4()}", json={"name": "New Name"})
    assert resp.status_code == 404


async def test_delete_zone(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/zones/", json={"project_id": str(project.id)})).json()

    del_resp = await client.delete(f"/api/v1/zones/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/zones/", params={"project_id": str(project.id)})).json()
    assert all(z["id"] != created["id"] for z in listing)


async def test_delete_unknown_zone_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/zones/{uuid.uuid4()}")
    assert resp.status_code == 404
