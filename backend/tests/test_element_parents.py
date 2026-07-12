from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


async def test_upsert_and_list_element_parent(client: AsyncClient, project: Project):
    resp = await client.put("/api/v1/element-parents/", json={
        "project_id": str(project.id), "child_element_ref": "trolley.glb", "parent_element_ref": "jib.glb",
    })
    assert resp.status_code == 200, resp.text
    created = resp.json()
    assert created["child_element_ref"] == "trolley.glb"
    assert created["parent_element_ref"] == "jib.glb"

    listing = (await client.get("/api/v1/element-parents/", params={"project_id": str(project.id)})).json()
    assert any(r["id"] == created["id"] for r in listing)


async def test_reparenting_same_child_repoints_instead_of_duplicating(client: AsyncClient, project: Project):
    first = (await client.put("/api/v1/element-parents/", json={
        "project_id": str(project.id), "child_element_ref": "trolley.glb", "parent_element_ref": "jib.glb",
    })).json()
    second = (await client.put("/api/v1/element-parents/", json={
        "project_id": str(project.id), "child_element_ref": "trolley.glb", "parent_element_ref": "base.glb",
    })).json()

    assert second["id"] == first["id"]
    assert second["parent_element_ref"] == "base.glb"

    listing = (await client.get("/api/v1/element-parents/", params={"project_id": str(project.id)})).json()
    assert len([r for r in listing if r["child_element_ref"] == "trolley.glb"]) == 1


async def test_self_parenting_rejected(client: AsyncClient, project: Project):
    resp = await client.put("/api/v1/element-parents/", json={
        "project_id": str(project.id), "child_element_ref": "jib.glb", "parent_element_ref": "jib.glb",
    })
    assert resp.status_code == 422


async def test_cycle_rejected(client: AsyncClient, project: Project):
    # base <- jib <- trolley already rigged; trying to make base a child of
    # trolley would close the loop.
    await client.put("/api/v1/element-parents/", json={
        "project_id": str(project.id), "child_element_ref": "jib.glb", "parent_element_ref": "base.glb",
    })
    await client.put("/api/v1/element-parents/", json={
        "project_id": str(project.id), "child_element_ref": "trolley.glb", "parent_element_ref": "jib.glb",
    })

    resp = await client.put("/api/v1/element-parents/", json={
        "project_id": str(project.id), "child_element_ref": "base.glb", "parent_element_ref": "trolley.glb",
    })
    assert resp.status_code == 422


async def test_delete_element_parent(client: AsyncClient, project: Project):
    created = (await client.put("/api/v1/element-parents/", json={
        "project_id": str(project.id), "child_element_ref": "trolley.glb", "parent_element_ref": "jib.glb",
    })).json()

    del_resp = await client.delete(f"/api/v1/element-parents/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/element-parents/", params={"project_id": str(project.id)})).json()
    assert all(r["id"] != created["id"] for r in listing)


async def test_delete_unknown_element_parent_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/element-parents/{uuid.uuid4()}")
    assert resp.status_code == 404
