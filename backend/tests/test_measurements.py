from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


def _length_points() -> list[dict]:
    return [{"x": 0.0, "y": 0.0, "z": 0.0}, {"x": 3.0, "y": 4.0, "z": 0.0}]


def _area_points(n: int = 4) -> list[dict]:
    return [{"x": float(i), "y": 0.0, "z": 0.0} for i in range(n)]


async def test_create_and_list_length_measurement(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/measurements/", json={
        "project_id": str(project.id), "kind": "length", "points": _length_points(), "value": 5.0,
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Measurement"
    assert created["kind"] == "length"
    assert created["value"] == 5.0
    assert created["visible"] is True
    assert len(created["points"]) == 2

    listing = (await client.get("/api/v1/measurements/", params={"project_id": str(project.id)})).json()
    assert any(m["id"] == created["id"] for m in listing)


async def test_create_area_measurement(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/measurements/", json={
        "project_id": str(project.id), "kind": "area", "points": _area_points(), "value": 12.5, "name": "Slab 1 top face",
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["kind"] == "area"
    assert created["name"] == "Slab 1 top face"
    assert len(created["points"]) == 4
    assert created["hole_loops"] == []


async def test_create_area_measurement_with_hole_loops(client: AsyncClient, project: Project):
    hole = [{"x": 1.0, "y": 1.0, "z": 0.0}, {"x": 2.0, "y": 1.0, "z": 0.0}, {"x": 2.0, "y": 2.0, "z": 0.0}]
    resp = await client.post("/api/v1/measurements/", json={
        "project_id": str(project.id), "kind": "area", "points": _area_points(), "value": 12.5,
        "hole_loops": [hole],
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert len(created["hole_loops"]) == 1
    assert len(created["hole_loops"][0]) == 3


async def test_length_measurement_rejects_wrong_point_count(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/measurements/", json={
        "project_id": str(project.id), "kind": "length", "points": _area_points(3), "value": 5.0,
    })
    assert resp.status_code == 422


async def test_area_measurement_rejects_too_few_points(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/measurements/", json={
        "project_id": str(project.id), "kind": "area", "points": _length_points(), "value": 5.0,
    })
    assert resp.status_code == 422


async def test_rename_and_toggle_visible(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/measurements/", json={
        "project_id": str(project.id), "kind": "length", "points": _length_points(), "value": 5.0,
    })).json()

    resp = await client.patch(f"/api/v1/measurements/{created['id']}", json={"name": "Beam span", "visible": False})
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["name"] == "Beam span"
    assert updated["visible"] is False
    assert updated["value"] == 5.0  # untouched field stays as it was


async def test_update_unknown_measurement_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/measurements/{uuid.uuid4()}", json={"name": "New Name"})
    assert resp.status_code == 404


async def test_delete_measurement(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/measurements/", json={
        "project_id": str(project.id), "kind": "length", "points": _length_points(), "value": 5.0,
    })).json()

    del_resp = await client.delete(f"/api/v1/measurements/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/measurements/", params={"project_id": str(project.id)})).json()
    assert all(m["id"] != created["id"] for m in listing)


async def test_delete_unknown_measurement_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/measurements/{uuid.uuid4()}")
    assert resp.status_code == 404
