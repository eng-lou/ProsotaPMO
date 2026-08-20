from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project


async def test_get_returns_default_when_nothing_saved(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/site-context/", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    default = resp.json()
    assert default["id"] is None
    assert default["project_id"] == str(project.id)
    assert default["enabled"] is False
    assert default["lat"] is None
    assert default["lon"] is None
    assert default["label"] is None
    assert default["offset_x"] == 0.0
    assert default["offset_y"] == 0.0
    assert default["offset_z"] == 0.0
    assert default["offset_yaw_deg"] == 0.0
    assert default["scale"] == 1.0


async def test_upsert_creates_then_updates_the_same_row(client: AsyncClient, project: Project):
    first = await client.put("/api/v1/site-context/", json={
        "project_id": str(project.id),
        "enabled": True,
        "lat": 51.5007, "lon": -0.1246,
        "label": "Site boundary",
        "offset_x": 12.5, "offset_y": 0.0, "offset_z": -4.2,
        "offset_yaw_deg": 37.5,
        "scale": 1.02,
    })
    assert first.status_code == 200, first.text
    created = first.json()
    assert created["id"] is not None
    assert created["enabled"] is True
    assert created["lat"] == 51.5007
    assert created["lon"] == -0.1246
    assert created["label"] == "Site boundary"
    assert created["offset_x"] == 12.5
    assert created["offset_z"] == -4.2
    assert created["offset_yaw_deg"] == 37.5
    assert created["scale"] == 1.02

    second = await client.put("/api/v1/site-context/", json={
        "project_id": str(project.id), "enabled": False,
    })
    assert second.status_code == 200, second.text
    updated = second.json()
    assert updated["id"] == created["id"]
    assert updated["enabled"] is False
    # lat/lon/offsets weren't sent on the second call — PUT upserts the
    # whole payload (unlike Radial Chart/Zone's own PATCH), so an omitted
    # field falls back to its schema default rather than staying set.
    assert updated["lat"] is None
    assert updated["offset_x"] == 0.0
    assert updated["scale"] == 1.0

    listing = await client.get("/api/v1/site-context/", params={"project_id": str(project.id)})
    assert listing.json()["id"] == created["id"]


async def test_latitude_must_be_within_range(client: AsyncClient, project: Project):
    resp = await client.put("/api/v1/site-context/", json={
        "project_id": str(project.id), "lat": 91.0,
    })
    assert resp.status_code == 422


async def test_longitude_must_be_within_range(client: AsyncClient, project: Project):
    resp = await client.put("/api/v1/site-context/", json={
        "project_id": str(project.id), "lon": -181.0,
    })
    assert resp.status_code == 422


async def test_scale_must_be_positive(client: AsyncClient, project: Project):
    resp = await client.put("/api/v1/site-context/", json={
        "project_id": str(project.id), "scale": 0,
    })
    assert resp.status_code == 422


async def test_tiles_key_returns_configured_value(client: AsyncClient):
    resp = await client.get("/api/v1/site-context/tiles-key")
    assert resp.status_code == 200, resp.text
    # Empty by default in a fresh test/dev environment (no key set in .env
    # or saved via the app itself) — see config.py's own comment on why
    # the default is deliberately "".
    assert "api_key" in resp.json()


async def test_tiles_key_can_be_set_and_read_back_from_the_app(client: AsyncClient):
    put_resp = await client.put("/api/v1/site-context/tiles-key", json={"api_key": "AIzaTestKey123"})
    assert put_resp.status_code == 200, put_resp.text
    assert put_resp.json()["api_key"] == "AIzaTestKey123"

    get_resp = await client.get("/api/v1/site-context/tiles-key")
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["api_key"] == "AIzaTestKey123"

    # Setting it again overwrites the same singleton row, not a second one.
    put_again = await client.put("/api/v1/site-context/tiles-key", json={"api_key": "AIzaTestKey456"})
    assert put_again.json()["api_key"] == "AIzaTestKey456"
    get_again = await client.get("/api/v1/site-context/tiles-key")
    assert get_again.json()["api_key"] == "AIzaTestKey456"
