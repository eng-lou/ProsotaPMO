from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, name: str = "Substructure") -> str:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": name,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_get_returns_default_when_nothing_saved(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/timeline-strips/", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    default = resp.json()
    assert default["id"] is None
    assert default["project_id"] == str(project.id)
    assert default["visible"] is True
    assert default["position_x_pct"] == 10.0
    assert default["position_y_pct"] == 90.0
    assert default["width_px"] == 900.0
    assert default["height_px"] == 56.0
    assert default["background_color"] == "#1f2937"
    assert default["band_border_color"] == "#ffffff"
    assert default["text_color"] == "#ffffff"
    assert default["playhead_color"] == "#ef4444"
    assert default["font_size"] == 11.0
    assert default["scope_mode"] == "all"
    assert default["udf_field_definition_id"] is None
    assert default["udf_value"] is None
    assert default["wbs_node_activity_id"] is None


async def test_upsert_creates_then_updates_the_same_row(client: AsyncClient, project: Project):
    first = await client.put("/api/v1/timeline-strips/", json={
        "project_id": str(project.id), "position_x_pct": 20.0, "width_px": 1200.0, "playhead_color": "#00ff00",
    })
    assert first.status_code == 200, first.text
    created = first.json()
    assert created["id"] is not None
    assert created["position_x_pct"] == 20.0
    assert created["width_px"] == 1200.0
    assert created["playhead_color"] == "#00ff00"

    second = await client.put("/api/v1/timeline-strips/", json={
        "project_id": str(project.id), "position_x_pct": 35.0,
    })
    assert second.status_code == 200, second.text
    updated = second.json()
    assert updated["id"] == created["id"]
    assert updated["position_x_pct"] == 35.0
    # width_px wasn't sent on the second call — PUT upserts the whole
    # payload (unlike Radial Chart/Zone's own PATCH), so an omitted field
    # falls back to its schema default rather than staying at 1200.0.
    assert updated["width_px"] == 900.0

    listing = await client.get("/api/v1/timeline-strips/", params={"project_id": str(project.id)})
    assert listing.json()["id"] == created["id"]


async def test_width_and_height_must_be_positive(client: AsyncClient, project: Project):
    resp = await client.put("/api/v1/timeline-strips/", json={"project_id": str(project.id), "width_px": 0})
    assert resp.status_code == 422

    resp2 = await client.put("/api/v1/timeline-strips/", json={"project_id": str(project.id), "height_px": 0})
    assert resp2.status_code == 422


async def test_position_pct_must_be_within_0_100(client: AsyncClient, project: Project):
    resp = await client.put("/api/v1/timeline-strips/", json={"project_id": str(project.id), "position_x_pct": 101})
    assert resp.status_code == 422


async def test_wbs_scope_round_trips(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)

    resp = await client.put("/api/v1/timeline-strips/", json={
        "project_id": str(project.id), "scope_mode": "wbs", "wbs_node_activity_id": activity_id,
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["scope_mode"] == "wbs"
    assert updated["wbs_node_activity_id"] == activity_id


async def test_font_size_must_be_positive(client: AsyncClient, project: Project):
    resp = await client.put("/api/v1/timeline-strips/", json={"project_id": str(project.id), "font_size": 0})
    assert resp.status_code == 422
