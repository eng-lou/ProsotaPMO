from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project


async def test_create_and_list_filter(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/scheduling-filters/", json={
        "project_id": str(project.id), "name": "Behind schedule milestones", "match_mode": "all",
        "conditions": [
            {"field": "activity_type", "operator": "eq", "value": "finish_milestone"},
            {"field": "variance_days", "operator": "gt", "value": "0"},
        ],
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Behind schedule milestones"
    assert created["match_mode"] == "all"
    assert len(created["conditions"]) == 2

    listing = (await client.get("/api/v1/scheduling-filters/", params={"project_id": str(project.id)})).json()
    assert any(f["id"] == created["id"] for f in listing)


async def test_create_defaults_match_mode_and_empty_conditions(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/scheduling-filters/", json={"project_id": str(project.id), "name": "Bare"})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["match_mode"] == "all"
    assert created["conditions"] == []


async def test_create_accepts_wbs_and_date_conditions(client: AsyncClient, project: Project):
    # Maro's own example: "where wbs is (then editable), 2nd condition, start
    # is less than (a date)" — a free-text WBS-branch match plus a date
    # comparison, the two field types added alongside the original number/
    # boolean/enum set.
    resp = await client.post("/api/v1/scheduling-filters/", json={
        "project_id": str(project.id), "name": "Building 1 early starts", "match_mode": "all",
        "conditions": [
            {"field": "wbs_path", "operator": "starts_with", "value": "1.2"},
            {"field": "start", "operator": "lt", "value": "2026-05-28"},
        ],
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["conditions"][0]["field"] == "wbs_path"
    assert created["conditions"][1]["operator"] == "lt"


async def test_create_accepts_sub_project_float_conditions(client: AsyncClient, project: Project):
    # docs/SUBPROJECT_FLOAT_PLAN.md §G — added 2026-07-06 alongside the rest
    # of the sub-project float feature.
    resp = await client.post("/api/v1/scheduling-filters/", json={
        "project_id": str(project.id), "name": "Sub-critical but not master-critical", "match_mode": "all",
        "conditions": [
            {"field": "sub_is_critical", "operator": "is_true", "value": ""},
            {"field": "sub_total_float_hours", "operator": "lte", "value": "0"},
        ],
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["conditions"][0]["field"] == "sub_is_critical"
    assert created["conditions"][1]["field"] == "sub_total_float_hours"


async def test_create_rejects_unknown_field(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/scheduling-filters/", json={
        "project_id": str(project.id), "name": "Bad",
        "conditions": [{"field": "not_a_real_field", "operator": "eq", "value": "x"}],
    })
    assert resp.status_code == 422


async def test_create_accepts_udf_condition(client: AsyncClient, project: Project):
    """2026-09-06, per Maro: "any udfs from an imported schedule is missed
    out" — FilterFieldKey used to be a strict Literal allow-list with no
    way to reference a real per-project UDF at all. "udf.<Name>" (the same
    convention app/schemas/dashboard_layout.py's own, already-unrestricted
    filter field already uses) is now accepted, while a genuinely bogus
    field is still rejected (test above) — the validator only recognizes
    two shapes: a known built-in, or "udf." with something after it."""
    resp = await client.post("/api/v1/scheduling-filters/", json={
        "project_id": str(project.id), "name": "By Discipline",
        "conditions": [{"field": "udf.Discipline", "operator": "eq", "value": "HVAC"}],
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["conditions"][0]["field"] == "udf.Discipline"


async def test_create_rejects_bare_udf_prefix_with_no_name(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/scheduling-filters/", json={
        "project_id": str(project.id), "name": "Bad",
        "conditions": [{"field": "udf.", "operator": "eq", "value": "x"}],
    })
    assert resp.status_code == 422


async def test_update_filter(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/scheduling-filters/", json={
        "project_id": str(project.id), "name": "Draft", "match_mode": "all",
        "conditions": [{"field": "is_critical", "operator": "is_true", "value": ""}],
    })
    filter_id = create_resp.json()["id"]

    update_resp = await client.patch(f"/api/v1/scheduling-filters/{filter_id}", json={
        "name": "Final", "match_mode": "any",
        "conditions": [
            {"field": "is_critical", "operator": "is_true", "value": ""},
            {"field": "total_float_hours", "operator": "lte", "value": "40"},
        ],
    })
    assert update_resp.status_code == 200, update_resp.text
    updated = update_resp.json()
    assert updated["name"] == "Final"
    assert updated["match_mode"] == "any"
    assert len(updated["conditions"]) == 2


async def test_delete_filter(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/scheduling-filters/", json={"project_id": str(project.id), "name": "Temp"})
    filter_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/scheduling-filters/{filter_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/scheduling-filters/", params={"project_id": str(project.id)})).json()
    assert all(f["id"] != filter_id for f in listing)
