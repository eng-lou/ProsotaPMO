from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project


async def test_get_returns_default_when_unsaved(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] is None
    assert data["header_left"]["text"] == "{project} — {module}"
    assert data["header_left"]["bold"] is True
    assert data["header_right"]["text"] == "Printed {printed_at}"
    assert data["footer_left"]["text"] == ""
    assert data["show_gantt_legend"] is False


async def test_save_then_get_persists_and_updates(client: AsyncClient, project: Project):
    payload = {
        "project_id": str(project.id),
        "logo_position": "left",
        "header_left": {"text": "ACME Co", "bold": True, "italic": False, "font_size": 18, "align": "left"},
        "header_center": {"text": "{module} Report", "bold": False, "italic": True, "font_size": 12, "align": "center"},
        "header_right": {"text": "Printed {printed_at}", "bold": False, "italic": False, "font_size": 10, "align": "right"},
        "footer_left": {"text": "Confidential", "bold": False, "italic": False, "font_size": 8, "align": "left"},
        "footer_center": {"text": "", "bold": False, "italic": False, "font_size": 11, "align": "center"},
        "footer_right": {"text": "", "bold": False, "italic": False, "font_size": 11, "align": "right"},
        "show_gantt_legend": True,
    }
    resp = await client.put("/api/v1/letterhead/", json=payload)
    assert resp.status_code == 200, resp.text
    saved = resp.json()
    assert saved["id"] is not None
    assert saved["header_left"]["text"] == "ACME Co"
    assert saved["header_center"]["italic"] is True
    assert saved["footer_left"]["text"] == "Confidential"
    assert saved["show_gantt_legend"] is True

    refetched = await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})
    assert refetched.json()["id"] == saved["id"]
    assert refetched.json()["header_left"]["font_size"] == 18

    # Saving again updates the same row rather than creating a second one.
    payload["header_left"]["text"] = "Updated Co"
    resp2 = await client.put("/api/v1/letterhead/", json=payload)
    assert resp2.json()["id"] == saved["id"]
    assert resp2.json()["header_left"]["text"] == "Updated Co"


async def test_oversized_logo_rejected(client: AsyncClient, project: Project):
    resp = await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id),
        "logo_data_url": "data:image/png;base64," + ("A" * 800_000),
    })
    assert resp.status_code == 422


async def test_print_column_widths_default_empty(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})
    assert resp.json()["print_column_widths"] == {}
    assert resp.json()["print_udf_column_width"] is None


async def test_print_font_sizes_default_and_persist(client: AsyncClient, project: Project):
    default = (await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})).json()
    assert default["print_font_size"] == 9
    assert default["header_print_font_size"] == 9
    assert default["gantt_print_font_size"] == 8

    resp = await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id),
        "print_font_size": 12, "header_print_font_size": 11, "gantt_print_font_size": 10,
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["print_font_size"] == 12
    assert resp.json()["header_print_font_size"] == 11
    assert resp.json()["gantt_print_font_size"] == 10

    refetched = await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})
    assert refetched.json()["print_font_size"] == 12


async def test_zone_font_family_defaults_and_persists(client: AsyncClient, project: Project):
    default = (await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})).json()
    assert default["header_left"]["font_family"] == "sans"

    resp = await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id),
        "header_left": {"text": "ACME Co", "bold": True, "italic": False, "font_size": 18, "font_family": "serif", "align": "left"},
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["header_left"]["font_family"] == "serif"

    refetched = await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})
    assert refetched.json()["header_left"]["font_family"] == "serif"


async def test_gantt_legend_font_size_defaults_and_persists(client: AsyncClient, project: Project):
    default = (await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})).json()
    assert default["gantt_legend_font_size"] == 9

    resp = await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id), "gantt_legend_font_size": 13,
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["gantt_legend_font_size"] == 13


async def test_print_font_family_defaults_and_persists(client: AsyncClient, project: Project):
    default = (await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})).json()
    assert default["print_font_family"] == "sans"
    assert default["gantt_print_font_family"] == "sans"

    resp = await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id), "print_font_family": "mono", "gantt_print_font_family": "serif",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["print_font_family"] == "mono"
    assert resp.json()["gantt_print_font_family"] == "serif"

    refetched = await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})
    assert refetched.json()["print_font_family"] == "mono"
    assert refetched.json()["gantt_print_font_family"] == "serif"


async def test_header_and_legend_print_font_family_defaults_and_persists(client: AsyncClient, project: Project):
    default = (await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})).json()
    assert default["header_print_font_family"] == "sans"
    assert default["gantt_legend_font_family"] == "sans"

    resp = await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id), "header_print_font_family": "serif", "gantt_legend_font_family": "mono",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["header_print_font_family"] == "serif"
    assert resp.json()["gantt_legend_font_family"] == "mono"

    refetched = await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})
    assert refetched.json()["header_print_font_family"] == "serif"
    assert refetched.json()["gantt_legend_font_family"] == "mono"


async def test_print_column_widths_persist(client: AsyncClient, project: Project):
    resp = await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id),
        "print_column_widths": {"duration": 80, "activity": 260},
        "print_udf_column_width": 100,
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["print_column_widths"] == {"duration": 80, "activity": 260}
    assert resp.json()["print_udf_column_width"] == 100

    refetched = await client.get("/api/v1/letterhead/", params={"project_id": str(project.id)})
    assert refetched.json()["print_column_widths"] == {"duration": 80, "activity": 260}
    assert refetched.json()["print_udf_column_width"] == 100
