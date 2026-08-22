from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _make_collection(client: AsyncClient, project: Project, name: str) -> str:
    resp = await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_capture(client: AsyncClient, project: Project, name: str = "cloud.xyz") -> str:
    data = {"project_id": str(project.id), "name": name, "captured_at": "2026-08-15", "kind": "xyz", "source_up_axis": "y"}
    files = {"file": (name, b"-21.7 -3.3 1.4 77 33 34\n", "application/octet-stream")}
    resp = await client.post("/api/v1/site-captures/", data=data, files=files)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_test(client: AsyncClient, project: Project, group_a: str, capture: str, **overrides) -> dict:
    body = {
        "project_id": str(project.id), "name": "Level 2 Slab Progress",
        "group_a_collection_id": group_a, "site_capture_id": capture,
        **overrides,
    }
    resp = await client.post("/api/v1/progress-variance-tests/", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_and_list_test(client: AsyncClient, project: Project):
    group_a = await _make_collection(client, project, "Complete per schedule")
    capture = await _make_capture(client, project)

    created = await _make_test(client, project, group_a, capture)
    assert created["name"] == "Level 2 Slab Progress"
    assert created["last_run_at"] is None
    assert created["min_coverage_percent"] == 50.0
    assert created["results"] == []

    listing = (await client.get("/api/v1/progress-variance-tests/", params={"project_id": str(project.id)})).json()
    assert any(t["id"] == created["id"] for t in listing)


async def test_update_test(client: AsyncClient, project: Project):
    group_a = await _make_collection(client, project, "Complete per schedule")
    capture = await _make_capture(client, project)
    created = await _make_test(client, project, group_a, capture)

    resp = await client.patch(
        f"/api/v1/progress-variance-tests/{created['id']}", json={"name": "Renamed", "min_coverage_percent": 75.0},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Renamed"
    assert resp.json()["min_coverage_percent"] == 75.0
    assert resp.json()["group_a_collection_id"] == group_a  # untouched field stays as it was


async def test_update_unknown_test_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/progress-variance-tests/{uuid.uuid4()}", json={"name": "New Name"})
    assert resp.status_code == 404


async def test_delete_test(client: AsyncClient, project: Project):
    group_a = await _make_collection(client, project, "Complete per schedule")
    capture = await _make_capture(client, project)
    created = await _make_test(client, project, group_a, capture)

    del_resp = await client.delete(f"/api/v1/progress-variance-tests/{created['id']}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/progress-variance-tests/", params={"project_id": str(project.id)})).json()
    assert all(t["id"] != created["id"] for t in listing)


def _element(ref: str, confirmed: bool, point_count: int = 12, coverage_percent: float = 80.0) -> dict:
    return {
        "element_source_kind": "ifc", "element_ref": ref, "element_label": ref,
        "point_count": point_count, "coverage_percent": coverage_percent, "confirmed_in_scan": confirmed,
    }


async def test_replace_results_creates_rows_and_sets_last_run_at(client: AsyncClient, project: Project):
    group_a = await _make_collection(client, project, "Complete per schedule")
    capture = await _make_capture(client, project)
    created = await _make_test(client, project, group_a, capture)

    resp = await client.put(
        f"/api/v1/progress-variance-tests/{created['id']}/results",
        json=[_element("wall-1", confirmed=True, coverage_percent=91.5)],
    )
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["last_run_at"] is not None
    assert len(updated["results"]) == 1
    assert updated["results"][0]["status"] == "new"
    assert updated["results"][0]["element_ref"] == "wall-1"
    assert updated["results"][0]["confirmed_in_scan"] is True
    assert updated["results"][0]["point_count"] == 12
    assert updated["results"][0]["coverage_percent"] == 91.5


async def test_replace_results_partial_coverage_not_confirmed(client: AsyncClient, project: Project):
    """The whole point of coverage_percent over the old raw point_count:
    an element that's genuinely part-built (e.g. a foundation poured but
    not finished) reads a real intermediate %, and stays unconfirmed
    against a test's own min_coverage_percent — not silently rounded up
    to "confirmed" by a single stray point cluster the old bounding-box
    count would have accepted."""
    group_a = await _make_collection(client, project, "Complete per schedule")
    capture = await _make_capture(client, project)
    created = await _make_test(client, project, group_a, capture, min_coverage_percent=60.0)

    resp = await client.put(
        f"/api/v1/progress-variance-tests/{created['id']}/results",
        json=[_element("foundation-a", confirmed=False, point_count=40, coverage_percent=35.0)],
    )
    assert resp.status_code == 200, resp.text
    result = resp.json()["results"][0]
    assert result["coverage_percent"] == 35.0
    assert result["confirmed_in_scan"] is False


async def test_replace_results_preserves_status_for_elements_still_in_group_a(client: AsyncClient, project: Project):
    """Same non-obvious rule as Clash Detective's own replace_results: a
    re-run must not reset review status/comment for an element still
    present in the run — only elements that genuinely dropped out of
    Group A should disappear."""
    group_a = await _make_collection(client, project, "Complete per schedule")
    capture = await _make_capture(client, project)
    created = await _make_test(client, project, group_a, capture)

    first_run = (await client.put(
        f"/api/v1/progress-variance-tests/{created['id']}/results",
        json=[_element("wall-1", confirmed=False), _element("wall-2", confirmed=True)],
    )).json()
    result_id = next(r["id"] for r in first_run["results"] if r["element_ref"] == "wall-1")

    patch_resp = await client.patch(
        f"/api/v1/progress-variance-results/{result_id}", json={"status": "approved", "comment": "site visit confirmed delay"},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    assert patch_resp.json()["status"] == "approved"

    # Re-run: wall-1 is still flagged (should keep its approved status +
    # comment, but refresh point_count), wall-2 dropped out of Group A
    # (should be removed), wall-3 is new (should insert as "new").
    second_run = (await client.put(
        f"/api/v1/progress-variance-tests/{created['id']}/results",
        json=[_element("wall-1", confirmed=False, point_count=3, coverage_percent=20.0), _element("wall-3", confirmed=True)],
    )).json()
    results_by_ref = {r["element_ref"]: r for r in second_run["results"]}

    assert set(results_by_ref.keys()) == {"wall-1", "wall-3"}
    preserved = results_by_ref["wall-1"]
    assert preserved["id"] == result_id
    assert preserved["status"] == "approved"
    assert preserved["comment"] == "site visit confirmed delay"
    assert preserved["point_count"] == 3  # refreshed even though status was preserved
    assert preserved["coverage_percent"] == 20.0  # refreshed too
    assert results_by_ref["wall-3"]["status"] == "new"


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, name: str, pct_complete: float | None = None) -> str:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": name,
    })
    assert resp.status_code == 201, resp.text
    activity_id = resp.json()["id"]
    if pct_complete is not None:
        patch_resp = await client.patch(f"/api/v1/activities/{activity_id}", json={"pct_complete": pct_complete})
        assert patch_resp.status_code == 200, patch_resp.text
    return activity_id


async def _link(client: AsyncClient, activity_id: str, element_ref: str) -> None:
    resp = await client.post("/api/v1/model-element-links/", json={
        "activity_id": activity_id, "source_kind": "ifc", "element_ref": element_ref, "element_label": element_ref,
    })
    assert resp.status_code == 201, resp.text


async def test_activity_progress_suggestions(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    """The actual "4D as-built" payoff: a test's own coverage_percent
    results roll up to whichever Activity each element is linked to via
    the existing ModelElementLink table — no new linking concept needed,
    per Maro's own "correlation/association instead of trying to build a
    fresh ifc" redirect."""
    group_a = await _make_collection(client, project, "Complete per schedule")
    capture = await _make_capture(client, project)
    created = await _make_test(client, project, group_a, capture)

    activity_id = await _create_activity(client, project, live_schedule_period, "Pour Level 2 Slab", pct_complete=20.0)
    await _link(client, activity_id, "wall-1")
    # A second element linked to the SAME activity that this test's own
    # Group A never actually scanned — linked_element_count should still
    # count it, matched_element_count should not.
    await _link(client, activity_id, "wall-2-not-in-this-test")

    # An activity with a link this test's results never match at all —
    # must not appear in the suggestions (nothing to suggest from).
    unrelated_activity_id = await _create_activity(client, project, live_schedule_period, "Unrelated Activity")
    await _link(client, unrelated_activity_id, "column-9")

    await client.put(
        f"/api/v1/progress-variance-tests/{created['id']}/results",
        json=[_element("wall-1", confirmed=True, coverage_percent=80.0)],
    )

    resp = await client.get(f"/api/v1/progress-variance-tests/{created['id']}/activity-progress-suggestions")
    assert resp.status_code == 200, resp.text
    suggestions = resp.json()

    assert len(suggestions) == 1
    suggestion = suggestions[0]
    assert suggestion["activity_id"] == activity_id
    assert suggestion["activity_name"] == "Pour Level 2 Slab"
    assert suggestion["current_pct_complete"] == "20.00"
    assert suggestion["scan_suggested_pct_complete"] == 80.0
    assert suggestion["linked_element_count"] == 2
    assert suggestion["matched_element_count"] == 1


async def test_activity_progress_suggestions_averages_multiple_matched_elements(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod,
):
    group_a = await _make_collection(client, project, "Complete per schedule")
    capture = await _make_capture(client, project)
    created = await _make_test(client, project, group_a, capture)

    activity_id = await _create_activity(client, project, live_schedule_period, "Erect Level 2 Walls")
    await _link(client, activity_id, "wall-1")
    await _link(client, activity_id, "wall-2")

    await client.put(
        f"/api/v1/progress-variance-tests/{created['id']}/results",
        json=[
            _element("wall-1", confirmed=True, coverage_percent=100.0),
            _element("wall-2", confirmed=False, coverage_percent=40.0),
        ],
    )

    resp = await client.get(f"/api/v1/progress-variance-tests/{created['id']}/activity-progress-suggestions")
    suggestion = resp.json()[0]
    assert suggestion["scan_suggested_pct_complete"] == 70.0  # (100 + 40) / 2
    assert suggestion["linked_element_count"] == 2
    assert suggestion["matched_element_count"] == 2


async def test_activity_progress_suggestions_unknown_test_404s(client: AsyncClient, project: Project):
    resp = await client.get(f"/api/v1/progress-variance-tests/{uuid.uuid4()}/activity-progress-suggestions")
    assert resp.status_code == 404


async def test_update_unknown_result_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/progress-variance-results/{uuid.uuid4()}", json={"status": "reviewed"})
    assert resp.status_code == 404


async def test_replace_results_unknown_test_404s(client: AsyncClient, project: Project):
    resp = await client.put(
        f"/api/v1/progress-variance-tests/{uuid.uuid4()}/results", json=[_element("wall-1", confirmed=True)],
    )
    assert resp.status_code == 404
