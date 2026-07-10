from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, name: str = "Pour Level 2 Slab") -> str:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "schedule_period_id": str(period.id),
        "task_name": name,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_create_and_list_ifc_link(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)

    resp = await client.post("/api/v1/model-element-links/", json={
        "activity_id": activity_id,
        "source_kind": "ifc",
        "element_ref": "2O2Fr$t4X7Zf8NOew3FLOH",
        "element_label": "IfcSlab: Level 2 Slab Panel A",
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["activity_id"] == activity_id
    assert created["source_kind"] == "ifc"
    assert created["project_id"] == str(project.id)

    listing = (await client.get("/api/v1/model-element-links/", params={"project_id": str(project.id)})).json()
    assert any(l["id"] == created["id"] for l in listing)


async def test_create_mesh_link(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)

    resp = await client.post("/api/v1/model-element-links/", json={
        "activity_id": activity_id,
        "source_kind": "mesh",
        "element_ref": "site-compound.glb",
        "element_label": "site-compound.glb",
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["source_kind"] == "mesh"


async def test_many_to_many_links_allowed(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_a = await _create_activity(client, project, live_schedule_period, "Pour Slab A")
    activity_b = await _create_activity(client, project, live_schedule_period, "Formwork Slab A")

    element_ref = "2O2Fr$t4X7Zf8NOew3FLOH"
    resp_a = await client.post("/api/v1/model-element-links/", json={
        "activity_id": activity_a, "source_kind": "ifc", "element_ref": element_ref, "element_label": "Slab Panel A",
    })
    resp_b = await client.post("/api/v1/model-element-links/", json={
        "activity_id": activity_b, "source_kind": "ifc", "element_ref": element_ref, "element_label": "Slab Panel A",
    })
    assert resp_a.status_code == 201, resp_a.text
    assert resp_b.status_code == 201, resp_b.text

    listing = (await client.get("/api/v1/model-element-links/", params={"project_id": str(project.id)})).json()
    matching = [l for l in listing if l["element_ref"] == element_ref]
    assert len(matching) == 2
    assert {l["activity_id"] for l in matching} == {activity_a, activity_b}


async def test_duplicate_link_rejected(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    payload = {
        "activity_id": activity_id, "source_kind": "ifc", "element_ref": "GID-1", "element_label": "Wall",
    }
    first = await client.post("/api/v1/model-element-links/", json=payload)
    assert first.status_code == 201, first.text

    second = await client.post("/api/v1/model-element-links/", json=payload)
    assert second.status_code == 409


async def test_create_link_unknown_activity_404s(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/model-element-links/", json={
        "activity_id": str(uuid.uuid4()), "source_kind": "ifc", "element_ref": "GID-1", "element_label": "Wall",
    })
    assert resp.status_code == 404


async def test_delete_link(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    create_resp = await client.post("/api/v1/model-element-links/", json={
        "activity_id": activity_id, "source_kind": "ifc", "element_ref": "GID-1", "element_label": "Wall",
    })
    link_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/model-element-links/{link_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/model-element-links/", params={"project_id": str(project.id)})).json()
    assert all(l["id"] != link_id for l in listing)


async def test_deleting_activity_cascades_its_links(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    await client.post("/api/v1/model-element-links/", json={
        "activity_id": activity_id, "source_kind": "ifc", "element_ref": "GID-1", "element_label": "Wall",
    })

    del_resp = await client.delete(f"/api/v1/activities/{activity_id}")
    assert del_resp.status_code in (200, 204)

    listing = (await client.get("/api/v1/model-element-links/", params={"project_id": str(project.id)})).json()
    assert listing == []


async def test_assign_and_clear_animation_profile(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    create_resp = await client.post("/api/v1/model-element-links/", json={
        "activity_id": activity_id, "source_kind": "ifc", "element_ref": "GID-1", "element_label": "Wall",
    })
    link_id = create_resp.json()["id"]
    assert create_resp.json()["animation_profile_id"] is None

    profile_resp = await client.post("/api/v1/animation-profiles/", json={"project_id": str(project.id), "name": "Pop Up Y"})
    profile_id = profile_resp.json()["id"]

    assign_resp = await client.patch(f"/api/v1/model-element-links/{link_id}", json={"animation_profile_id": profile_id})
    assert assign_resp.status_code == 200, assign_resp.text
    assert assign_resp.json()["animation_profile_id"] == profile_id

    clear_resp = await client.patch(f"/api/v1/model-element-links/{link_id}", json={"animation_profile_id": None})
    assert clear_resp.status_code == 200, clear_resp.text
    assert clear_resp.json()["animation_profile_id"] is None


async def test_deleting_animation_profile_clears_link_assignment(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity_id = await _create_activity(client, project, live_schedule_period)
    create_resp = await client.post("/api/v1/model-element-links/", json={
        "activity_id": activity_id, "source_kind": "ifc", "element_ref": "GID-1", "element_label": "Wall",
    })
    link_id = create_resp.json()["id"]

    profile_resp = await client.post("/api/v1/animation-profiles/", json={"project_id": str(project.id), "name": "Pop Up Y"})
    profile_id = profile_resp.json()["id"]
    await client.patch(f"/api/v1/model-element-links/{link_id}", json={"animation_profile_id": profile_id})

    del_resp = await client.delete(f"/api/v1/animation-profiles/{profile_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/model-element-links/", params={"project_id": str(project.id)})).json()
    link = next(l for l in listing if l["id"] == link_id)
    assert link["animation_profile_id"] is None
