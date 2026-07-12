from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


async def _make_collection(client: AsyncClient, project: Project, name: str) -> str:
    resp = await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_test(client: AsyncClient, project: Project, group_a: str, group_b: str, **overrides) -> dict:
    body = {
        "project_id": str(project.id), "name": "Walls vs Pipes",
        "group_a_collection_id": group_a, "group_b_collection_id": group_b,
        "test_type": "hard", "tolerance_mm": 0.0,
        **overrides,
    }
    resp = await client.post("/api/v1/clash-tests/", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_and_list_clash_test(client: AsyncClient, project: Project):
    group_a = await _make_collection(client, project, "Walls")
    group_b = await _make_collection(client, project, "Pipes")

    created = await _make_test(client, project, group_a, group_b)
    assert created["name"] == "Walls vs Pipes"
    assert created["test_type"] == "hard"
    assert created["last_run_at"] is None
    assert created["results"] == []

    listing = (await client.get("/api/v1/clash-tests/", params={"project_id": str(project.id)})).json()
    assert any(t["id"] == created["id"] for t in listing)


async def test_update_clash_test(client: AsyncClient, project: Project):
    group_a = await _make_collection(client, project, "Walls")
    group_b = await _make_collection(client, project, "Pipes")
    created = await _make_test(client, project, group_a, group_b)

    resp = await client.patch(f"/api/v1/clash-tests/{created['id']}", json={"test_type": "clearance", "tolerance_mm": 50.0})
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["test_type"] == "clearance"
    assert updated["tolerance_mm"] == 50.0
    assert updated["name"] == "Walls vs Pipes"  # untouched field stays as it was


async def test_update_unknown_clash_test_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/clash-tests/{uuid.uuid4()}", json={"name": "New Name"})
    assert resp.status_code == 404


async def test_delete_clash_test(client: AsyncClient, project: Project):
    group_a = await _make_collection(client, project, "Walls")
    group_b = await _make_collection(client, project, "Pipes")
    created = await _make_test(client, project, group_a, group_b)

    del_resp = await client.delete(f"/api/v1/clash-tests/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/clash-tests/", params={"project_id": str(project.id)})).json()
    assert all(t["id"] != created["id"] for t in listing)


def _pair(a_ref: str, b_ref: str, distance: float | None = None) -> dict:
    return {
        "element_a_source_kind": "ifc", "element_a_ref": a_ref, "element_a_label": a_ref,
        "element_b_source_kind": "ifc", "element_b_ref": b_ref, "element_b_label": b_ref,
        "distance_mm": distance,
    }


async def test_replace_results_creates_rows_and_sets_last_run_at(client: AsyncClient, project: Project):
    group_a = await _make_collection(client, project, "Walls")
    group_b = await _make_collection(client, project, "Pipes")
    created = await _make_test(client, project, group_a, group_b)

    resp = await client.put(f"/api/v1/clash-tests/{created['id']}/results", json=[_pair("wall-1", "pipe-1")])
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["last_run_at"] is not None
    assert len(updated["results"]) == 1
    assert updated["results"][0]["status"] == "new"
    assert updated["results"][0]["element_a_ref"] == "wall-1"
    assert updated["results"][0]["element_b_ref"] == "pipe-1"


async def test_replace_results_preserves_status_for_pairs_that_still_clash(client: AsyncClient, project: Project):
    """The one non-obvious piece of logic: re-running a test must not reset
    the review status of a clash that still exists — only clashes that
    genuinely disappeared should drop out."""
    group_a = await _make_collection(client, project, "Walls")
    group_b = await _make_collection(client, project, "Pipes")
    created = await _make_test(client, project, group_a, group_b)

    first_run = (await client.put(
        f"/api/v1/clash-tests/{created['id']}/results",
        json=[_pair("wall-1", "pipe-1"), _pair("wall-2", "pipe-2")],
    )).json()
    result_id = next(r["id"] for r in first_run["results"] if r["element_a_ref"] == "wall-1")

    patch_resp = await client.patch(f"/api/v1/clash-results/{result_id}", json={"status": "approved", "comment": "known, ok"})
    assert patch_resp.status_code == 200, patch_resp.text
    assert patch_resp.json()["status"] == "approved"

    # Re-run: wall-1/pipe-1 still clashes (should keep its approved status +
    # comment), wall-2/pipe-2 no longer does (should be dropped), a new
    # wall-3/pipe-3 clash appears (should insert as "new").
    second_run = (await client.put(
        f"/api/v1/clash-tests/{created['id']}/results",
        json=[_pair("wall-1", "pipe-1", distance=1.5), _pair("wall-3", "pipe-3")],
    )).json()
    results_by_pair = {(r["element_a_ref"], r["element_b_ref"]): r for r in second_run["results"]}

    assert set(results_by_pair.keys()) == {("wall-1", "pipe-1"), ("wall-3", "pipe-3")}
    preserved = results_by_pair[("wall-1", "pipe-1")]
    assert preserved["id"] == result_id
    assert preserved["status"] == "approved"
    assert preserved["comment"] == "known, ok"
    assert preserved["distance_mm"] == 1.5  # refreshed even though status was preserved
    assert results_by_pair[("wall-3", "pipe-3")]["status"] == "new"


async def test_update_unknown_clash_result_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/clash-results/{uuid.uuid4()}", json={"status": "reviewed"})
    assert resp.status_code == 404
