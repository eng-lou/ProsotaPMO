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
        "day_start_time": "07:00:00",
        "day_end_time": "17:00:00",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Saturday Working"
    assert data["works_saturday"] is True
    assert data["is_project_default"] is False
    # No breaks on a freshly-created calendar (only the lazily-seeded default gets
    # one) -> hours_per_day is the full 07:00-17:00 envelope.
    assert float(data["hours_per_day"]) == 10.0


async def test_duplicate_calendar_clones_breaks_and_exceptions(client: AsyncClient, project: Project):
    original = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Weekend Working", "works_saturday": True,
        "day_start_time": "07:00:00", "day_end_time": "18:00:00",
    })
    calendar_id = original.json()["id"]

    await client.post("/api/v1/calendar-breaks/", json={
        "calendar_id": calendar_id, "label": "Lunch", "start_time": "12:00:00", "end_time": "12:30:00",
    })
    await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar_id, "label": "Christmas Shutdown",
        "start_date": "2026-12-24", "end_date": "2027-01-02", "is_working": False,
    })

    resp = await client.post(f"/api/v1/calendars/{calendar_id}/duplicate")
    assert resp.status_code == 201
    clone = resp.json()
    assert clone["id"] != calendar_id
    assert clone["name"] == "Weekend Working (copy)"
    assert clone["is_project_default"] is False
    assert clone["works_saturday"] is True
    assert clone["day_start_time"] == "07:00:00"
    # 07:00-18:00 (11h) minus the cloned 30-min lunch break = 10.5h.
    assert float(clone["hours_per_day"]) == 10.5

    breaks = await client.get("/api/v1/calendar-breaks/", params={"calendar_id": clone["id"]})
    assert len(breaks.json()) == 1
    assert breaks.json()[0]["label"] == "Lunch"

    exceptions = await client.get("/api/v1/calendar-exceptions/", params={"calendar_id": clone["id"]})
    assert len(exceptions.json()) == 1
    assert exceptions.json()[0]["label"] == "Christmas Shutdown"

    # Editing the original afterwards must never touch the clone.
    await client.patch(f"/api/v1/calendars/{calendar_id}", json={"name": "Renamed"})
    clone_after = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    clone_row = next(c for c in clone_after.json() if c["id"] == clone["id"])
    assert clone_row["name"] == "Weekend Working (copy)"


async def test_create_calendar_rejects_end_before_start(client: AsyncClient, project: Project):
    resp = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Bad Calendar",
        "day_start_time": "17:00:00", "day_end_time": "08:00:00",
    })
    assert resp.status_code == 422


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


async def test_activity_calendar_override(client: AsyncClient, project: Project, live_schedule_period):
    create = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Saturday Working", "works_saturday": True,
    })
    calendar_id = create.json()["id"]

    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id), "task_name": "Excavation",
        "calendar_id": calendar_id,
    })
    assert resp.status_code == 201
    assert resp.json()["calendar_id"] == calendar_id


async def test_activity_calendar_must_be_in_same_project(
    client: AsyncClient, db, project: Project, live_schedule_period, org
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
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id), "task_name": "Excavation",
        "calendar_id": calendar_id,
    })
    assert resp.status_code == 404


async def test_deleting_calendar_reverts_activities_to_default(
    client: AsyncClient, db, project: Project, live_schedule_period
):
    from app.models.activity import Activity

    create = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Concrete Calendar",
    })
    calendar_id = create.json()["id"]

    activity_resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id), "task_name": "Excavation",
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


async def test_adding_exception_immediately_recomputes_affected_activities(
    client: AsyncClient, db, project: Project, live_schedule_period
):
    """Regression test: adding a non-working exception used to save fine but
    never trigger a recompute — an activity's dates only shifted around it
    once some *unrelated* edit happened to trigger the CPM engine next,
    making the exception look like it silently did nothing (2026-07-04, per
    Maro: "add exception isn't working")."""
    from datetime import date
    live_schedule_period.start_date = date(2025, 6, 2)  # a Monday
    await db.commit()

    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]

    activity = (await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id),
        "task_name": "Excavation", "duration_hours": 8,
    })).json()
    assert activity["start"].startswith("2025-06-02")  # scheduled on the Monday, as expected

    resp = await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar_id, "label": "Site Closure", "start_date": "2025-06-02", "end_date": "2025-06-02",
        "is_working": False,
    })
    assert resp.status_code == 201

    # No unrelated activity edit happened — the exception alone must have
    # triggered the recompute for the activity to have moved off the Monday.
    refreshed = (await client.get(f"/api/v1/activities/{activity['id']}")).json()
    assert not refreshed["start"].startswith("2025-06-02")
    assert refreshed["start"].startswith("2025-06-03")  # pushed to the Tuesday


async def test_editing_an_existing_exception_recomputes_and_moves_the_date(
    client: AsyncClient, db, project: Project, live_schedule_period
):
    """Same regression as above, but for the Edit path added 2026-07-06 —
    moving an already-saved exception to a different date must genuinely
    move the affected activity's computed dates, not just save silently."""
    from datetime import date
    live_schedule_period.start_date = date(2025, 6, 2)  # a Monday
    await db.commit()

    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]

    activity = (await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id),
        "task_name": "Excavation", "duration_hours": 8,
    })).json()
    assert activity["start"].startswith("2025-06-02")

    create_resp = await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar_id, "label": "Site Closure", "start_date": "2025-06-03", "end_date": "2025-06-03",
        "is_working": False,
    })
    assert create_resp.status_code == 201
    exception_id = create_resp.json()["id"]

    # Closing Tuesday doesn't touch a Monday-only activity — confirms the
    # baseline before the edit is the one actually being tested below.
    unaffected = (await client.get(f"/api/v1/activities/{activity['id']}")).json()
    assert unaffected["start"].startswith("2025-06-02")

    # Edit the exception onto the Monday instead — this is the activity's
    # actual working day, so it must move off it purely from this edit.
    patch_resp = await client.patch(f"/api/v1/calendar-exceptions/{exception_id}", json={
        "start_date": "2025-06-02", "end_date": "2025-06-02",
    })
    assert patch_resp.status_code == 200, patch_resp.text

    refreshed = (await client.get(f"/api/v1/activities/{activity['id']}")).json()
    assert not refreshed["start"].startswith("2025-06-02")
    assert refreshed["start"].startswith("2025-06-03")


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


async def test_partial_day_exception_requires_both_times(client: AsyncClient, project: Project):
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]

    resp = await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar_id, "label": "Late delivery",
        "start_date": "2025-06-02", "end_date": "2025-06-02", "is_working": False,
        "start_time": "08:00:00",  # end_time missing
    })
    assert resp.status_code == 422


async def test_partial_day_exception_accepted(client: AsyncClient, project: Project):
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]

    resp = await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar_id, "label": "Late delivery",
        "start_date": "2025-06-02", "end_date": "2025-06-02", "is_working": False,
        "start_time": "08:00:00", "end_time": "09:00:00",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["start_time"] == "08:00:00"
    assert data["end_time"] == "09:00:00"


# --- Calendar breaks (Phase 10) -----------------------------------------------

async def test_create_calendar_break(client: AsyncClient, project: Project):
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]

    resp = await client.post("/api/v1/calendar-breaks/", json={
        "calendar_id": calendar_id, "label": "Afternoon tea", "start_time": "15:00:00", "end_time": "15:15:00",
    })
    assert resp.status_code == 201
    assert resp.json()["label"] == "Afternoon tea"

    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    # Default calendar already has a 12:00-13:00 lunch break seeded (8h/day) -> adding
    # a second 15-minute break reduces net hours/day further.
    assert float(calendars.json()[0]["hours_per_day"]) == 7.75


async def test_calendar_break_rejects_end_before_start(client: AsyncClient, project: Project):
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]

    resp = await client.post("/api/v1/calendar-breaks/", json={
        "calendar_id": calendar_id, "label": "Bad break", "start_time": "13:00:00", "end_time": "12:00:00",
    })
    assert resp.status_code == 422


async def test_list_and_delete_calendar_break(client: AsyncClient, project: Project):
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    calendar_id = calendars.json()[0]["id"]
    create = await client.post("/api/v1/calendar-breaks/", json={
        "calendar_id": calendar_id, "label": "Afternoon tea", "start_time": "15:00:00", "end_time": "15:15:00",
    })
    break_id = create.json()["id"]

    resp = await client.get("/api/v1/calendar-breaks/", params={"calendar_id": calendar_id})
    assert resp.status_code == 200
    assert len(resp.json()) == 2  # the seeded lunch break + the new one

    resp = await client.delete(f"/api/v1/calendar-breaks/{break_id}")
    assert resp.status_code == 204

    resp = await client.get("/api/v1/calendar-breaks/", params={"calendar_id": calendar_id})
    assert len(resp.json()) == 1
