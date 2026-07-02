from __future__ import annotations

from httpx import AsyncClient

from app.models.project import Project


async def test_list_calendars_lazy_seeds_standard_calendar(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Standard Calendar"
    assert data[0]["is_project_default"] is True
    assert data[0]["works_monday"] is True
    assert data[0]["works_saturday"] is False
    assert float(data[0]["hours_per_day"]) == 8.0


async def test_create_calendar(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id),
        "name": "Saturday Working",
        "works_saturday": True,
        "hours_per_day": "10",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Saturday Working"
    assert data["works_saturday"] is True
    assert data["is_project_default"] is False


async def test_creating_new_default_clears_previous(client: AsyncClient, project: Project):
    # Lazy-seed the Standard Calendar as default first.
    await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})

    resp = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "New Default", "is_project_default": True,
    })
    assert resp.status_code == 201

    resp = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    defaults = [c for c in resp.json() if c["is_project_default"]]
    assert len(defaults) == 1
    assert defaults[0]["name"] == "New Default"


async def test_cannot_unset_default_without_replacement(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    standard = resp.json()[0]

    resp = await client.patch(f"/api/v1/calendars/{standard['id']}", json={"is_project_default": False})
    assert resp.status_code == 422


async def test_cannot_delete_default_calendar(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    standard = resp.json()[0]

    resp = await client.delete(f"/api/v1/calendars/{standard['id']}")
    assert resp.status_code == 422


async def test_delete_non_default_calendar(client: AsyncClient, project: Project):
    await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    create = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Concrete Calendar", "works_saturday": True,
    })
    calendar_id = create.json()["id"]

    resp = await client.delete(f"/api/v1/calendars/{calendar_id}")
    assert resp.status_code == 204


async def test_activity_calendar_override(client: AsyncClient, project: Project, live_period):
    create = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Saturday Working", "works_saturday": True,
    })
    calendar_id = create.json()["id"]

    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Excavation",
        "calendar_id": calendar_id,
    })
    assert resp.status_code == 201
    assert resp.json()["calendar_id"] == calendar_id


async def test_activity_calendar_must_be_in_same_project(
    client: AsyncClient, db, project: Project, live_period, org
):
    from app.models.project import Project as ProjectModel

    other_project = ProjectModel(org_id=org.id, name="Other Project")
    db.add(other_project)
    await db.commit()
    await db.refresh(other_project)

    create = await client.post("/api/v1/calendars/", json={
        "project_id": str(other_project.id), "name": "Foreign Calendar",
    })
    calendar_id = create.json()["id"]

    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Excavation",
        "calendar_id": calendar_id,
    })
    assert resp.status_code == 404


async def test_deleting_calendar_reverts_activities_to_default(
    client: AsyncClient, db, project: Project, live_period
):
    from app.models.activity import Activity

    create = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Concrete Calendar",
    })
    calendar_id = create.json()["id"]

    activity_resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Excavation",
        "calendar_id": calendar_id,
    })
    activity_id = activity_resp.json()["id"]

    resp = await client.delete(f"/api/v1/calendars/{calendar_id}")
    assert resp.status_code == 204

    db.expunge_all()
    refreshed = await db.get(Activity, activity_id)
    assert refreshed is not None
    assert refreshed.calendar_id is None


# --- Calendar exceptions ------------------------------------------------------

async def test_create_calendar_exception(client: AsyncClient, project: Project):
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]

    resp = await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar_id,
        "label": "Christmas Shutdown",
        "start_date": "2025-12-22",
        "end_date": "2026-01-02",
        "is_working": False,
    })
    assert resp.status_code == 201
    assert resp.json()["label"] == "Christmas Shutdown"


async def test_exception_end_before_start_rejected(client: AsyncClient, project: Project):
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]

    resp = await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar_id, "label": "Bad range", "start_date": "2025-06-10", "end_date": "2025-06-01",
    })
    assert resp.status_code == 422


async def test_list_exceptions_by_calendar(client: AsyncClient, project: Project):
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]
    await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar_id, "label": "Good Friday", "start_date": "2025-04-18", "end_date": "2025-04-18",
    })

    resp = await client.get("/api/v1/calendar-exceptions/", params={"calendar_id": calendar_id})
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_delete_exception(client: AsyncClient, project: Project):
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]
    create = await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar_id, "label": "Good Friday", "start_date": "2025-04-18", "end_date": "2025-04-18",
    })
    exception_id = create.json()["id"]

    resp = await client.delete(f"/api/v1/calendar-exceptions/{exception_id}")
    assert resp.status_code == 204
