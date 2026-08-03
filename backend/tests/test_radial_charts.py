from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_udf_field(client: AsyncClient, project: Project, name: str = "Sub Discipline") -> dict:
    resp = await client.post("/api/v1/user-defined-fields/definitions", json={
        "project_id": str(project.id), "entity_type": "activity", "name": name, "data_type": "text",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, name: str = "Substructure") -> str:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": name,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_create_and_list_radial_chart(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id)})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["title"] == "Radial Chart"
    assert created["visible"] is True
    assert created["position_x_pct"] == 4.0
    assert created["position_y_pct"] == 70.0
    assert created["radius_px"] == 48.0
    assert created["thickness_px"] == 8.0
    assert created["border_color"] == "#ffffff"
    assert created["track_color"] == "#374151"
    assert created["progress_color"] == "#f97316"
    assert created["fill_color"] == "#111827"
    assert created["text_color"] == "#ffffff"
    assert created["center_mode"] == "percentage"
    assert created["icon_storage_filename"] is None
    assert created["udf_field_definition_id"] is None
    assert created["udf_value"] is None
    assert created["scope_mode"] == "all"
    assert created["wbs_node_activity_id"] is None
    assert created["font_size"] == 14.0

    listing = (await client.get("/api/v1/radial-charts/", params={"project_id": str(project.id)})).json()
    assert any(c["id"] == created["id"] for c in listing)


async def test_position_pct_must_be_within_0_100(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id), "position_x_pct": 101})
    assert resp.status_code == 422

    resp2 = await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id), "position_y_pct": -1})
    assert resp2.status_code == 422


async def test_radius_and_thickness_must_be_positive(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id), "radius_px": 0})
    assert resp.status_code == 422

    resp2 = await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id), "thickness_px": 0})
    assert resp2.status_code == 422


async def test_update_style_and_position(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id)})).json()

    resp = await client.patch(f"/api/v1/radial-charts/{created['id']}", json={
        "title": "Concrete Structure", "position_x_pct": 80.0, "position_y_pct": 10.0,
        "track_color": "#222222", "progress_color": "#ff0000", "fill_color": "#000000",
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["title"] == "Concrete Structure"
    assert updated["position_x_pct"] == 80.0
    assert updated["position_y_pct"] == 10.0
    assert updated["track_color"] == "#222222"
    assert updated["progress_color"] == "#ff0000"
    assert updated["fill_color"] == "#000000"
    assert updated["visible"] is True  # untouched field stays as it was


async def test_update_udf_filter(client: AsyncClient, project: Project):
    field = await _create_udf_field(client, project)
    created = (await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id)})).json()

    resp = await client.patch(f"/api/v1/radial-charts/{created['id']}", json={
        "udf_field_definition_id": field["id"], "udf_value": "Concrete Works",
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["udf_field_definition_id"] == field["id"]
    assert updated["udf_value"] == "Concrete Works"


async def test_update_wbs_scope(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    created = (await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id)})).json()

    resp = await client.patch(f"/api/v1/radial-charts/{created['id']}", json={
        "scope_mode": "wbs", "wbs_node_activity_id": activity_id,
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["scope_mode"] == "wbs"
    assert updated["wbs_node_activity_id"] == activity_id


async def test_update_font_size(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id)})).json()

    resp = await client.patch(f"/api/v1/radial-charts/{created['id']}", json={"font_size": 20.0})
    assert resp.status_code == 200, resp.text
    assert resp.json()["font_size"] == 20.0


async def test_font_size_must_be_positive(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id), "font_size": 0})
    assert resp.status_code == 422


async def test_upload_and_download_icon_round_trips_bytes(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id)})).json()

    upload = await client.post(
        f"/api/v1/radial-charts/{created['id']}/icon",
        files={"file": ("crane.png", b"exact-png-bytes", "image/png")},
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["center_mode"] == "icon"
    assert upload.json()["icon_storage_filename"] is not None

    download = await client.get(f"/api/v1/radial-charts/{created['id']}/icon")
    assert download.status_code == 200
    assert download.content == b"exact-png-bytes"


async def test_download_missing_icon_404s(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id)})).json()
    resp = await client.get(f"/api/v1/radial-charts/{created['id']}/icon")
    assert resp.status_code == 404


async def test_switching_center_mode_away_from_icon_clears_it(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id)})).json()
    await client.post(
        f"/api/v1/radial-charts/{created['id']}/icon",
        files={"file": ("crane.png", b"bytes", "image/png")},
    )

    resp = await client.patch(f"/api/v1/radial-charts/{created['id']}", json={"center_mode": "percentage"})
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["center_mode"] == "percentage"
    assert updated["icon_storage_filename"] is None

    download = await client.get(f"/api/v1/radial-charts/{created['id']}/icon")
    assert download.status_code == 404


async def test_update_unknown_chart_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/radial-charts/{uuid.uuid4()}", json={"title": "New Name"})
    assert resp.status_code == 404


async def test_delete_radial_chart(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/radial-charts/", json={"project_id": str(project.id)})).json()

    del_resp = await client.delete(f"/api/v1/radial-charts/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/radial-charts/", params={"project_id": str(project.id)})).json()
    assert all(c["id"] != created["id"] for c in listing)


async def test_delete_unknown_chart_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/radial-charts/{uuid.uuid4()}")
    assert resp.status_code == 404
