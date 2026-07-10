from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project


async def test_create_and_list_highlight(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/scheduling-highlights/", json={
        "project_id": str(project.id), "name": "High cost variance", "match_mode": "all",
        "conditions": [
            {"field": "cv", "operator": "lt", "value": "0"},
            {"field": "activity_type", "operator": "eq", "value": "task"},
        ],
    })
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "High cost variance"
    assert created["match_mode"] == "all"
    assert len(created["conditions"]) == 2

    listing = (await client.get("/api/v1/scheduling-highlights/", params={"project_id": str(project.id)})).json()
    assert any(h["id"] == created["id"] for h in listing)


async def test_create_defaults_match_mode_and_empty_conditions(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/scheduling-highlights/", json={"project_id": str(project.id), "name": "Bare"})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["match_mode"] == "all"
    assert created["conditions"] == []


async def test_create_rejects_unknown_field(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/scheduling-highlights/", json={
        "project_id": str(project.id), "name": "Bad",
        "conditions": [{"field": "not_a_real_field", "operator": "eq", "value": "x"}],
    })
    assert resp.status_code == 422


async def test_update_highlight(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/scheduling-highlights/", json={
        "project_id": str(project.id), "name": "Draft", "match_mode": "all",
        "conditions": [{"field": "is_critical", "operator": "is_true", "value": ""}],
    })
    highlight_id = create_resp.json()["id"]

    update_resp = await client.patch(f"/api/v1/scheduling-highlights/{highlight_id}", json={
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


async def test_delete_highlight(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/scheduling-highlights/", json={"project_id": str(project.id), "name": "Temp"})
    highlight_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/scheduling-highlights/{highlight_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/scheduling-highlights/", params={"project_id": str(project.id)})).json()
    assert all(h["id"] != highlight_id for h in listing)
