from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project


async def test_active_style_defaults_when_no_layout_applied(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/gantt-layouts/active-style", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    style = resp.json()
    assert style["baseline_color"] == "#eab308"
    assert style["baseline_thickness"] == 7
    assert style["wbs_level_colors"][0] == "#374151"
    assert len(style["wbs_level_colors"]) == 6


async def test_create_does_not_apply(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/gantt-layouts/", json={
        "project_id": str(project.id), "name": "Muted",
        "style": {"critical_color": "#aa0000"},
    })
    assert resp.status_code == 201, resp.text
    layout = resp.json()
    assert layout["is_active"] is False

    style = (await client.get("/api/v1/gantt-layouts/active-style", params={"project_id": str(project.id)})).json()
    assert style["critical_color"] == "#ef4444"  # still the default — not applied yet


async def test_gantt_font_family_is_independent_of_table_font_family(client: AsyncClient, project: Project):
    default = (await client.get("/api/v1/gantt-layouts/active-style", params={"project_id": str(project.id)})).json()
    assert default["table_font_family"] == "sans"
    assert default["gantt_font_family"] == "sans"

    create_resp = await client.post("/api/v1/gantt-layouts/", json={
        "project_id": str(project.id), "name": "Serif Gantt",
        "style": {"table_font_family": "mono", "gantt_font_family": "serif"},
    })
    assert create_resp.status_code == 201, create_resp.text
    layout_id = create_resp.json()["id"]
    assert create_resp.json()["style"]["table_font_family"] == "mono"
    assert create_resp.json()["style"]["gantt_font_family"] == "serif"

    await client.post(f"/api/v1/gantt-layouts/{layout_id}/apply")
    applied = (await client.get("/api/v1/gantt-layouts/active-style", params={"project_id": str(project.id)})).json()
    assert applied["table_font_family"] == "mono"
    assert applied["gantt_font_family"] == "serif"


async def test_header_font_family_defaults_and_persists(client: AsyncClient, project: Project):
    default = (await client.get("/api/v1/gantt-layouts/active-style", params={"project_id": str(project.id)})).json()
    assert default["header_font_family"] == "sans"

    create_resp = await client.post("/api/v1/gantt-layouts/", json={
        "project_id": str(project.id), "name": "Serif Header", "style": {"header_font_family": "serif"},
    })
    assert create_resp.status_code == 201, create_resp.text
    layout_id = create_resp.json()["id"]
    assert create_resp.json()["style"]["header_font_family"] == "serif"

    await client.post(f"/api/v1/gantt-layouts/{layout_id}/apply")
    applied = (await client.get("/api/v1/gantt-layouts/active-style", params={"project_id": str(project.id)})).json()
    assert applied["header_font_family"] == "serif"


async def test_apply_activates_and_snapshots_letterhead(client: AsyncClient, project: Project):
    await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id),
        "header_left": {"text": "Before Save", "bold": True, "italic": False, "font_size": 20, "align": "left"},
    })

    create_resp = await client.post("/api/v1/gantt-layouts/", json={
        "project_id": str(project.id), "name": "Corporate",
        "style": {"critical_color": "#123456"},
    })
    layout_id = create_resp.json()["id"]

    # Change the live letterhead after saving the layout.
    await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id),
        "header_left": {"text": "After Save", "bold": False, "italic": False, "font_size": 20, "align": "left"},
    })

    apply_resp = await client.post(f"/api/v1/gantt-layouts/{layout_id}/apply")
    assert apply_resp.status_code == 200, apply_resp.text
    assert apply_resp.json()["is_active"] is True

    letterhead = (await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})).json()
    assert letterhead["header_left"]["text"] == "Before Save"

    style = (await client.get("/api/v1/gantt-layouts/active-style", params={"project_id": str(project.id)})).json()
    assert style["critical_color"] == "#123456"


async def test_applying_second_layout_deactivates_first(client: AsyncClient, project: Project):
    r1 = await client.post("/api/v1/gantt-layouts/", json={"project_id": str(project.id), "name": "A"})
    r2 = await client.post("/api/v1/gantt-layouts/", json={"project_id": str(project.id), "name": "B"})
    id1, id2 = r1.json()["id"], r2.json()["id"]

    await client.post(f"/api/v1/gantt-layouts/{id1}/apply")
    await client.post(f"/api/v1/gantt-layouts/{id2}/apply")

    listing = (await client.get("/api/v1/gantt-layouts/", params={"project_id": str(project.id)})).json()
    active = [l for l in listing if l["is_active"]]
    assert len(active) == 1
    assert active[0]["id"] == id2


async def test_delete_layout(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/gantt-layouts/", json={"project_id": str(project.id), "name": "Temp"})
    layout_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/gantt-layouts/{layout_id}")
    assert del_resp.status_code == 204

    listing = (await client.get("/api/v1/gantt-layouts/", params={"project_id": str(project.id)})).json()
    assert all(l["id"] != layout_id for l in listing)


async def test_update_layout_renames_and_restyles(client: AsyncClient, project: Project):
    create_resp = await client.post("/api/v1/gantt-layouts/", json={
        "project_id": str(project.id), "name": "Draft", "style": {"critical_color": "#111111"},
    })
    layout_id = create_resp.json()["id"]
    await client.post(f"/api/v1/gantt-layouts/{layout_id}/apply")

    update_resp = await client.patch(f"/api/v1/gantt-layouts/{layout_id}", json={
        "name": "Final", "style": {"critical_color": "#222222"},
    })
    assert update_resp.status_code == 200, update_resp.text
    assert update_resp.json()["name"] == "Final"
    assert update_resp.json()["style"]["critical_color"] == "#222222"

    # Editing the currently-active layout takes effect immediately.
    style = (await client.get("/api/v1/gantt-layouts/active-style", params={"project_id": str(project.id)})).json()
    assert style["critical_color"] == "#222222"


async def test_reset_clears_active_layout_and_letterhead(client: AsyncClient, project: Project):
    await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id),
        "header_left": {"text": "Custom Header", "bold": True, "italic": False, "font_size": 20, "align": "left"},
    })
    create_resp = await client.post("/api/v1/gantt-layouts/", json={
        "project_id": str(project.id), "name": "Loud", "style": {"critical_color": "#999999"},
    })
    layout_id = create_resp.json()["id"]
    await client.post(f"/api/v1/gantt-layouts/{layout_id}/apply")

    reset_resp = await client.post("/api/v1/gantt-layouts/reset", params={"project_id": str(project.id)})
    assert reset_resp.status_code == 204

    style = (await client.get("/api/v1/gantt-layouts/active-style", params={"project_id": str(project.id)})).json()
    assert style["critical_color"] == "#ef4444"

    letterhead = (await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})).json()
    assert letterhead["header_left"]["text"] == "{project} — {module}"

    # The saved layout itself still exists, just no longer active.
    listing = (await client.get("/api/v1/gantt-layouts/", params={"project_id": str(project.id)})).json()
    assert any(l["id"] == layout_id for l in listing)
    assert all(not l["is_active"] for l in listing)
