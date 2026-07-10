from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project


async def test_upsert_creates_keyframe(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/element-keyframes/", json={
        "project_id": str(project.id),
        "source_kind": "mesh",
        "element_ref": "crane.glb",
        "field": "pos_x",
        "date": "2026-01-01T00:00:00Z",
        "value": 12.5,
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["value"] == 12.5
    assert body["field"] == "pos_x"

    listing = (await client.get("/api/v1/element-keyframes/", params={"project_id": str(project.id)})).json()
    assert len(listing) == 1
    assert listing[0]["id"] == body["id"]


async def test_upsert_same_identity_overwrites_value(client: AsyncClient, project: Project):
    payload = {
        "project_id": str(project.id),
        "source_kind": "mesh",
        "element_ref": "crane.glb",
        "field": "rot_y",
        "date": "2026-01-01T00:00:00Z",
        "value": 0,
    }
    first = await client.post("/api/v1/element-keyframes/", json=payload)
    assert first.status_code == 201, first.text
    first_id = first.json()["id"]

    second = await client.post("/api/v1/element-keyframes/", json={**payload, "value": 90})
    assert second.status_code == 201, second.text
    assert second.json()["id"] == first_id
    assert second.json()["value"] == 90

    listing = (await client.get("/api/v1/element-keyframes/", params={"project_id": str(project.id)})).json()
    assert len(listing) == 1


async def test_different_fields_are_independent_tracks(client: AsyncClient, project: Project):
    base = {
        "project_id": str(project.id),
        "source_kind": "mesh",
        "element_ref": "crane.glb",
        "date": "2026-01-01T00:00:00Z",
    }
    await client.post("/api/v1/element-keyframes/", json={**base, "field": "pos_x", "value": 1})
    await client.post("/api/v1/element-keyframes/", json={**base, "field": "pos_y", "value": 2})

    listing = (await client.get("/api/v1/element-keyframes/", params={"project_id": str(project.id)})).json()
    assert len(listing) == 2
    fields = {row["field"] for row in listing}
    assert fields == {"pos_x", "pos_y"}


async def test_delete_keyframe(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/element-keyframes/", json={
        "project_id": str(project.id),
        "source_kind": "mesh",
        "element_ref": "crane.glb",
        "field": "scale_x",
        "date": "2026-01-01T00:00:00Z",
        "value": 1.5,
    })
    keyframe_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/element-keyframes/{keyframe_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/element-keyframes/", params={"project_id": str(project.id)})).json()
    assert all(row["id"] != keyframe_id for row in listing)


async def test_delete_missing_keyframe_404s(client: AsyncClient, project: Project):
    resp = await client.delete("/api/v1/element-keyframes/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


async def test_list_scoped_to_project(client: AsyncClient, db: AsyncSession, project: Project):
    other_project = Project(org_id=project.org_id, name="Other Project", client_name="Other Client")
    db.add(other_project)
    await db.commit()
    await db.refresh(other_project)

    await client.post("/api/v1/element-keyframes/", json={
        "project_id": str(project.id),
        "source_kind": "mesh",
        "element_ref": "crane.glb",
        "field": "pos_z",
        "date": "2026-01-01T00:00:00Z",
        "value": 3,
    })
    await client.post("/api/v1/element-keyframes/", json={
        "project_id": str(other_project.id),
        "source_kind": "mesh",
        "element_ref": "truck.glb",
        "field": "pos_z",
        "date": "2026-01-01T00:00:00Z",
        "value": 9,
    })

    listing = (await client.get("/api/v1/element-keyframes/", params={"project_id": str(project.id)})).json()
    assert len(listing) == 1
    assert listing[0]["element_ref"] == "crane.glb"
