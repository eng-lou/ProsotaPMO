from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project


async def test_active_config_defaults_when_no_layout_applied(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/dashboard-layouts/active-config", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    config = resp.json()
    widget_types = {w["widget_type"] for w in config["widgets"]}
    assert widget_types == {"kpi_strip", "schedule_performance", "risk_overview", "milestone_timeline", "risk_exposure", "top_risks"}


async def test_create_does_not_apply(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/dashboard-layouts/", json={
        "project_id": str(project.id), "name": "My Layout",
        "config": {"widgets": [{"id": "kpi_strip", "widget_type": "kpi_strip", "x": 0, "y": 0, "w": 12, "h": 2}]},
    })
    assert resp.status_code == 201, resp.text
    layout = resp.json()
    assert layout["is_active"] is False

    config = (await client.get("/api/v1/dashboard-layouts/active-config", params={"project_id": str(project.id)})).json()
    assert len(config["widgets"]) == 6  # still the default — not applied yet


async def test_apply_activates_layout_and_persists_positions(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/dashboard-layouts/", json={
        "project_id": str(project.id), "name": "Rearranged",
        "config": {"widgets": [{"id": "kpi_strip", "widget_type": "kpi_strip", "x": 3, "y": 1, "w": 9, "h": 2}]},
    })
    assert create_resp.status_code == 201, create_resp.text
    layout_id = create_resp.json()["id"]

    apply_resp = await client.post(f"/api/v1/dashboard-layouts/{layout_id}/apply")
    assert apply_resp.status_code == 200, apply_resp.text
    assert apply_resp.json()["is_active"] is True

    config = (await client.get("/api/v1/dashboard-layouts/active-config", params={"project_id": str(project.id)})).json()
    assert config["widgets"] == [{"id": "kpi_strip", "widget_type": "kpi_strip", "x": 3, "y": 1, "w": 9, "h": 2}]


async def test_applying_second_layout_deactivates_first(client: AsyncClient, project: Project):
    r1 = await client.post("/api/v1/dashboard-layouts/", json={"project_id": str(project.id), "name": "A"})
    r2 = await client.post("/api/v1/dashboard-layouts/", json={"project_id": str(project.id), "name": "B"})
    id1, id2 = r1.json()["id"], r2.json()["id"]

    await client.post(f"/api/v1/dashboard-layouts/{id1}/apply")
    await client.post(f"/api/v1/dashboard-layouts/{id2}/apply")

    listing = (await client.get("/api/v1/dashboard-layouts/", params={"project_id": str(project.id)})).json()
    active = [l for l in listing if l["is_active"]]
    assert len(active) == 1
    assert active[0]["id"] == id2


async def test_delete_layout(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/dashboard-layouts/", json={"project_id": str(project.id), "name": "Temp"})
    layout_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/dashboard-layouts/{layout_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/dashboard-layouts/", params={"project_id": str(project.id)})).json()
    assert all(l["id"] != layout_id for l in listing)


async def test_update_layout_renames_and_reconfigures(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/dashboard-layouts/", json={
        "project_id": str(project.id), "name": "Draft",
        "config": {"widgets": [{"id": "kpi_strip", "widget_type": "kpi_strip", "x": 0, "y": 0, "w": 12, "h": 2}]},
    })
    layout_id = create_resp.json()["id"]
    await client.post(f"/api/v1/dashboard-layouts/{layout_id}/apply")

    update_resp = await client.patch(f"/api/v1/dashboard-layouts/{layout_id}", json={
        "name": "Final",
        "config": {"widgets": [{"id": "top_risks", "widget_type": "top_risks", "x": 0, "y": 0, "w": 12, "h": 5}]},
    })
    assert update_resp.status_code == 200, update_resp.text
    assert update_resp.json()["name"] == "Final"
    assert update_resp.json()["config"]["widgets"][0]["widget_type"] == "top_risks"

    # Editing the currently-active layout takes effect immediately.
    config = (await client.get("/api/v1/dashboard-layouts/active-config", params={"project_id": str(project.id)})).json()
    assert config["widgets"][0]["widget_type"] == "top_risks"


async def test_reset_clears_active_layout_without_deleting_it(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/dashboard-layouts/", json={
        "project_id": str(project.id), "name": "Custom",
        "config": {"widgets": [{"id": "top_risks", "widget_type": "top_risks", "x": 0, "y": 0, "w": 12, "h": 5}]},
    })
    layout_id = create_resp.json()["id"]
    await client.post(f"/api/v1/dashboard-layouts/{layout_id}/apply")

    reset_resp = await client.post("/api/v1/dashboard-layouts/reset", params={"project_id": str(project.id)})
    assert reset_resp.status_code == 204

    config = (await client.get("/api/v1/dashboard-layouts/active-config", params={"project_id": str(project.id)})).json()
    assert len(config["widgets"]) == 6  # back to the built-in default

    listing = (await client.get("/api/v1/dashboard-layouts/", params={"project_id": str(project.id)})).json()
    assert any(l["id"] == layout_id for l in listing)
    assert all(not l["is_active"] for l in listing)
