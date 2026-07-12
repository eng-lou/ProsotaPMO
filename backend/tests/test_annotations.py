from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, name: str = "Site Walkdown") -> str:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "schedule_period_id": str(period.id),
        "task_name": name,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _placemark_payload(project_id: str, **overrides) -> dict:
    payload = {
        "project_id": project_id, "kind": "placemark",
        "position_x": 1.0, "position_y": 2.0, "position_z": 3.0,
        "text": "Check this column",
    }
    payload.update(overrides)
    return payload


async def test_create_and_list_placemark(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/annotations/", json=_placemark_payload(str(project.id)))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["kind"] == "placemark"
    assert created["icon"] == "pin"
    assert created["visible"] is True
    assert created["source_kind"] is None
    assert created["element_ref"] is None
    # Style/behaviour defaults (2026-07-12) — match annotation.py's own
    # Python-side defaults exactly.
    assert created["has_background"] is True
    assert created["background_color"] == "#f59e0b"
    assert created["border_color"] == "#ffffff"
    assert created["thick_border"] is False
    assert created["text_color"] == "#111827"
    assert created["font_size"] == 14
    assert created["hide_closer_than"] is None
    assert created["hide_farther_than"] is None
    assert created["status"] == "open"

    listing = (await client.get("/api/v1/annotations/", params={"project_id": str(project.id)})).json()
    assert any(a["id"] == created["id"] for a in listing)


async def test_create_comment(client: AsyncClient, project: Project):
    # Comment (2026-07-12) — folded in as a third kind alongside Placemark/
    # Footnote after the fuller Navisworks reference showed it as the same
    # kind of spatial 3D marker, not a CameraView-attached review note.
    resp = await client.post("/api/v1/annotations/", json=_placemark_payload(str(project.id), kind="comment", icon="comment"))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["kind"] == "comment"
    assert created["icon"] == "comment"
    assert created["status"] == "open"


async def test_resolve_and_reopen_comment(client: AsyncClient, project: Project):
    # status (2026-07-12, per Maro: "so what's the difference [between
    # Comment and Footnote]") — the one functional distinction: Comment is
    # a review note you resolve, Footnote is a permanent technical callout.
    created = (await client.post("/api/v1/annotations/", json=_placemark_payload(str(project.id), kind="comment"))).json()

    resolved = await client.patch(f"/api/v1/annotations/{created['id']}", json={"status": "resolved"})
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"

    reopened = await client.patch(f"/api/v1/annotations/{created['id']}", json={"status": "open"})
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "open"


async def test_create_footnote_with_element_leader(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/annotations/", json=_placemark_payload(
        str(project.id), kind="footnote", source_kind="mesh", element_ref="crane.glb", icon="flag",
    ))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["kind"] == "footnote"
    assert created["source_kind"] == "mesh"
    assert created["element_ref"] == "crane.glb"
    assert created["icon"] == "flag"


async def test_update_text_position_and_style(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/annotations/", json=_placemark_payload(str(project.id)))).json()

    resp = await client.patch(f"/api/v1/annotations/{created['id']}", json={
        "text": "Resolved", "position_x": 9.0, "background_color": "#ff0000", "visible": False,
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["text"] == "Resolved"
    assert updated["position_x"] == 9.0
    assert updated["background_color"] == "#ff0000"
    assert updated["visible"] is False
    assert updated["position_y"] == 2.0  # untouched field stays as it was


async def test_update_behaviour_and_border_style(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/annotations/", json=_placemark_payload(str(project.id)))).json()

    resp = await client.patch(f"/api/v1/annotations/{created['id']}", json={
        "border_color": "#000000", "thick_border": True, "text_color": "#ffffff", "font_size": 20,
        "hide_closer_than": 2.5, "hide_farther_than": 100.0, "has_background": False,
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["border_color"] == "#000000"
    assert updated["thick_border"] is True
    assert updated["text_color"] == "#ffffff"
    assert updated["font_size"] == 20
    assert updated["hide_closer_than"] == 2.5
    assert updated["hide_farther_than"] == 100.0
    assert updated["has_background"] is False


async def test_font_size_out_of_range_rejected(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/annotations/", json=_placemark_payload(str(project.id), **{"font_size": 200}))
    assert resp.status_code == 422


async def test_update_unknown_annotation_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/annotations/{uuid.uuid4()}", json={"text": "x"})
    assert resp.status_code == 404


async def test_delete_annotation(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/annotations/", json=_placemark_payload(str(project.id)))).json()

    del_resp = await client.delete(f"/api/v1/annotations/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/annotations/", params={"project_id": str(project.id)})).json()
    assert all(a["id"] != created["id"] for a in listing)


async def test_delete_unknown_annotation_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/annotations/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_annotation_keyframe_visible_field(client: AsyncClient, project: Project):
    annotation = (await client.post("/api/v1/annotations/", json=_placemark_payload(str(project.id)))).json()

    resp = await client.post("/api/v1/element-keyframes/", json={
        "project_id": str(project.id),
        "source_kind": "annotation",
        "element_ref": annotation["id"],
        "field": "visible",
        "date": "2026-01-01T00:00:00Z",
        "value": 0,
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["field"] == "visible"

    listing = (await client.get("/api/v1/element-keyframes/", params={"project_id": str(project.id)})).json()
    assert any(k["element_ref"] == annotation["id"] and k["field"] == "visible" for k in listing)


async def test_annotation_can_link_to_activity(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    annotation = (await client.post("/api/v1/annotations/", json=_placemark_payload(str(project.id)))).json()
    activity_id = await _create_activity(client, project, live_schedule_period)

    resp = await client.post("/api/v1/model-element-links/", json={
        "activity_id": activity_id,
        "source_kind": "annotation",
        "element_ref": annotation["id"],
        "element_label": "Check this column",
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["source_kind"] == "annotation"
    assert resp.json()["element_ref"] == annotation["id"]
