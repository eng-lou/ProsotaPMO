from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


async def test_create_and_list_collection(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/collections/", json={"project_id": str(project.id)})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Collection"
    assert created["parent_collection_id"] is None
    assert created["project_id"] == str(project.id)
    assert created["members"] == []
    assert created["sort_order"] == 0

    listing = (await client.get("/api/v1/collections/", params={"project_id": str(project.id)})).json()
    assert any(c["id"] == created["id"] for c in listing)


async def test_create_sub_collection_gets_own_sibling_order(client: AsyncClient, project: Project):
    parent = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "Doors"})).json()

    first = (await client.post(
        "/api/v1/collections/", json={"project_id": str(project.id), "name": "Ground Floor", "parent_collection_id": parent["id"]},
    )).json()
    second = (await client.post(
        "/api/v1/collections/", json={"project_id": str(project.id), "name": "First Floor", "parent_collection_id": parent["id"]},
    )).json()

    assert first["parent_collection_id"] == parent["id"]
    assert second["sort_order"] == first["sort_order"] + 1
    # A sub-collection's own sibling order is independent of top-level siblings.
    top_level = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "Windows"})).json()
    assert top_level["sort_order"] == 1  # second top-level collection (after "Doors"), not affected by Doors' children


async def test_create_sub_collection_unknown_parent_404s(client: AsyncClient, project: Project):
    resp = await client.post(
        "/api/v1/collections/", json={"project_id": str(project.id), "parent_collection_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 404


async def test_rename_collection(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/collections/", json={"project_id": str(project.id)})).json()

    resp = await client.patch(f"/api/v1/collections/{created['id']}", json={"name": "Doors"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Doors"


async def test_reparent_collection(client: AsyncClient, project: Project):
    doors = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "Doors"})).json()
    ground_floor = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "Ground Floor"})).json()

    resp = await client.patch(f"/api/v1/collections/{doors['id']}", json={"parent_collection_id": ground_floor["id"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["parent_collection_id"] == ground_floor["id"]


async def test_reparent_to_top_level_with_explicit_null(client: AsyncClient, project: Project):
    parent = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "Parent"})).json()
    child = (await client.post(
        "/api/v1/collections/", json={"project_id": str(project.id), "name": "Child", "parent_collection_id": parent["id"]},
    )).json()

    resp = await client.patch(f"/api/v1/collections/{child['id']}", json={"parent_collection_id": None})
    assert resp.status_code == 200, resp.text
    assert resp.json()["parent_collection_id"] is None


async def test_reparent_cycle_422s(client: AsyncClient, project: Project):
    a = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "A"})).json()
    b = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "B", "parent_collection_id": a["id"]})).json()

    # A is already B's parent; trying to make A a child of B would create a cycle.
    resp = await client.patch(f"/api/v1/collections/{a['id']}", json={"parent_collection_id": b["id"]})
    assert resp.status_code == 422


async def test_reparent_to_self_422s(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/collections/", json={"project_id": str(project.id)})).json()
    resp = await client.patch(f"/api/v1/collections/{created['id']}", json={"parent_collection_id": created["id"]})
    assert resp.status_code == 422


async def test_reparent_unknown_target_404s(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/collections/", json={"project_id": str(project.id)})).json()
    resp = await client.patch(f"/api/v1/collections/{created['id']}", json={"parent_collection_id": str(uuid.uuid4())})
    assert resp.status_code == 404


async def test_update_unknown_collection_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/collections/{uuid.uuid4()}", json={"name": "New Name"})
    assert resp.status_code == 404


async def test_delete_collection(client: AsyncClient, project: Project):
    created = (await client.post("/api/v1/collections/", json={"project_id": str(project.id)})).json()

    del_resp = await client.delete(f"/api/v1/collections/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/collections/", params={"project_id": str(project.id)})).json()
    assert all(c["id"] != created["id"] for c in listing)


async def test_delete_unknown_collection_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/collections/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_deleting_parent_cascades_sub_collections(client: AsyncClient, project: Project):
    parent = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "Doors"})).json()
    child = (await client.post(
        "/api/v1/collections/", json={"project_id": str(project.id), "name": "Ground Floor", "parent_collection_id": parent["id"]},
    )).json()

    del_resp = await client.delete(f"/api/v1/collections/{parent['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/collections/", params={"project_id": str(project.id)})).json()
    assert all(c["id"] != child["id"] for c in listing)


# --- Members -----------------------------------------------------------

async def test_add_member_and_see_it_embedded_in_list(client: AsyncClient, project: Project):
    collection = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "Doors"})).json()

    resp = await client.post("/api/v1/collection-members/", json={
        "collection_id": collection["id"], "source_kind": "ifc",
        "element_ref": "2O2Fr$t4X7Zf8NOew3FLOH", "element_label": "IFCDOOR (2O2Fr$t4)",
    })
    assert resp.status_code == 201, resp.text
    member = resp.json()
    assert member["collection_id"] == collection["id"]

    listing = (await client.get("/api/v1/collections/", params={"project_id": str(project.id)})).json()
    found = next(c for c in listing if c["id"] == collection["id"])
    assert len(found["members"]) == 1
    assert found["members"][0]["element_ref"] == "2O2Fr$t4X7Zf8NOew3FLOH"


async def test_add_member_unknown_collection_404s(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/collection-members/", json={
        "collection_id": str(uuid.uuid4()), "source_kind": "mesh", "element_ref": "chair.glb", "element_label": "chair.glb",
    })
    assert resp.status_code == 404


async def test_add_duplicate_member_to_same_collection_409s(client: AsyncClient, project: Project):
    collection = (await client.post("/api/v1/collections/", json={"project_id": str(project.id)})).json()
    payload = {"collection_id": collection["id"], "source_kind": "mesh", "element_ref": "chair.glb", "element_label": "chair.glb"}

    first = await client.post("/api/v1/collection-members/", json=payload)
    assert first.status_code == 201

    second = await client.post("/api/v1/collection-members/", json=payload)
    assert second.status_code == 409


async def test_same_element_can_belong_to_two_different_collections(client: AsyncClient, project: Project):
    collection_a = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "A"})).json()
    collection_b = (await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": "B"})).json()

    def member_payload(collection_id: str) -> dict:
        return {"collection_id": collection_id, "source_kind": "mesh", "element_ref": "chair.glb", "element_label": "chair.glb"}

    resp_a = await client.post("/api/v1/collection-members/", json=member_payload(collection_a["id"]))
    resp_b = await client.post("/api/v1/collection-members/", json=member_payload(collection_b["id"]))
    assert resp_a.status_code == 201
    assert resp_b.status_code == 201  # same element_ref, different collection -- no global uniqueness


async def test_remove_member(client: AsyncClient, project: Project):
    collection = (await client.post("/api/v1/collections/", json={"project_id": str(project.id)})).json()
    member = (await client.post("/api/v1/collection-members/", json={
        "collection_id": collection["id"], "source_kind": "mesh", "element_ref": "chair.glb", "element_label": "chair.glb",
    })).json()

    del_resp = await client.delete(f"/api/v1/collection-members/{member['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/collections/", params={"project_id": str(project.id)})).json()
    found = next(c for c in listing if c["id"] == collection["id"])
    assert found["members"] == []


async def test_remove_unknown_member_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/collection-members/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_deleting_collection_cascades_its_members(client: AsyncClient, project: Project):
    # Without ondelete="CASCADE" on CollectionMember.collection_id, this delete
    # would 500 on a foreign-key violation (the member row still referencing
    # the collection being deleted) instead of succeeding cleanly.
    collection = (await client.post("/api/v1/collections/", json={"project_id": str(project.id)})).json()
    await client.post("/api/v1/collection-members/", json={
        "collection_id": collection["id"], "source_kind": "mesh", "element_ref": "chair.glb", "element_label": "chair.glb",
    })

    del_resp = await client.delete(f"/api/v1/collections/{collection['id']}")
    assert del_resp.status_code == 204
