from __future__ import annotations

from httpx import AsyncClient

from app.models.period import Period
from app.models.project import Project


async def _create_activity(client: AsyncClient, project: Project, period: Period, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_resource(client: AsyncClient, project: Project, **overrides) -> dict:
    payload = {"project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "45"}
    payload.update(overrides)
    resp = await client.post("/api/v1/resources/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _linked_element(client: AsyncClient, project: Project, period: Period) -> dict | None:
    resp = await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id), "period_id": str(period.id)})
    assert resp.status_code == 200
    linked = [e for e in resp.json() if e["source"] == "schedule"]
    return linked[0] if linked else None


async def test_first_assignment_creates_linked_cost_element(client: AsyncClient, project: Project, live_period: Period):
    activity = await _create_activity(client, project, live_period, "Piling", duration_hours=40)  # 5 days
    resource = await _create_resource(client, project, rate="45")

    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })

    element = await _linked_element(client, project, live_period)
    assert element is not None
    assert element["linked_activity_id"] == activity["id"]
    assert float(element["budget"]) == 225.0  # 5 days * 100% * 45
    assert activity["task_name"] in element["description"]


async def test_pct_complete_syncs_from_activity_to_linked_element(
    client: AsyncClient, project: Project, live_period: Period
):
    """% Complete is set once, on the activity — a schedule-linked Cost Element
    must never carry its own separate, independently-editable progress figure,
    else Scheduling's and Cost Plan's EVM for the same line silently diverge
    (see app/services/cost_sync.py:sync_cost_element_pct_complete)."""
    activity = await _create_activity(client, project, live_period, "Piling", pct_complete="30")
    resource = await _create_resource(client, project, rate="45")

    # First assignment (element created fresh): should pick up the activity's
    # already-existing % complete immediately, not start blank.
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })
    element = await _linked_element(client, project, live_period)
    assert element["pct_complete"] == 30

    # Later activity edits keep the linked element in step.
    resp = await client.patch(f"/api/v1/activities/{activity['id']}", json={"pct_complete": "75"})
    assert resp.status_code == 200
    element = await _linked_element(client, project, live_period)
    assert element["pct_complete"] == 75


async def test_second_assignment_updates_budget_and_rate_lines(
    client: AsyncClient, project: Project, live_period: Period
):
    activity = await _create_activity(client, project, live_period, "Piling", duration_hours=40)  # 5 days
    labour = await _create_resource(client, project, rate="45")
    material = await _create_resource(client, project, resource_type="material", name="Piles", unit="nr", rate="800")

    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": labour["id"], "utilisation_pct": "100",
    })
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": material["id"], "quantity": "2",
    })

    element = await _linked_element(client, project, live_period)
    assert float(element["budget"]) == 225.0 + 1600.0  # (5d*100%*45) + (2*800)

    lines = await client.get("/api/v1/cost-rate-lines/", params={"cost_element_id": element["id"]})
    assert lines.status_code == 200
    assert len(lines.json()) == 2


async def test_removing_last_assignment_deletes_linked_element(
    client: AsyncClient, project: Project, live_period: Period
):
    activity = await _create_activity(client, project, live_period, "Piling")
    resource = await _create_resource(client, project)
    create = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"],
    })

    assert await _linked_element(client, project, live_period) is not None

    await client.delete(f"/api/v1/resource-assignments/{create.json()['id']}")
    assert await _linked_element(client, project, live_period) is None


async def test_editing_budget_directly_unlinks_element(client: AsyncClient, project: Project, live_period: Period):
    activity = await _create_activity(client, project, live_period, "Piling", duration_hours=40)
    resource = await _create_resource(client, project, rate="45")
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })
    element = await _linked_element(client, project, live_period)
    assert element["source"] == "schedule"

    resp = await client.patch(f"/api/v1/cost-elements/{element['id']}", json={"budget": "9999.00"})
    assert resp.status_code == 200
    assert resp.json()["source"] == "manual"
    assert float(resp.json()["budget"]) == 9999.0

    # Further resource assignment changes no longer touch the now-unlinked element.
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "80",
    })
    resp = await client.get(f"/api/v1/cost-elements/{element['id']}")
    assert float(resp.json()["budget"]) == 9999.0
    assert resp.json()["source"] == "manual"


async def test_metadata_only_edit_does_not_unlink(client: AsyncClient, project: Project, live_period: Period):
    activity = await _create_activity(client, project, live_period, "Piling")
    resource = await _create_resource(client, project)
    await client.post("/api/v1/resource-assignments/", json={"activity_id": activity["id"], "resource_id": resource["id"]})
    element = await _linked_element(client, project, live_period)

    resp = await client.patch(f"/api/v1/cost-elements/{element['id']}", json={"cost_owner": "QS Team"})
    assert resp.status_code == 200
    assert resp.json()["source"] == "schedule"
    assert resp.json()["cost_owner"] == "QS Team"


async def test_editing_rate_line_directly_unlinks_element(client: AsyncClient, project: Project, live_period: Period):
    activity = await _create_activity(client, project, live_period, "Piling", duration_hours=40)
    resource = await _create_resource(client, project, rate="45")
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })
    element = await _linked_element(client, project, live_period)
    lines = (await client.get("/api/v1/cost-rate-lines/", params={"cost_element_id": element["id"]})).json()
    line_id = lines[0]["id"]

    resp = await client.patch(f"/api/v1/cost-rate-lines/{line_id}", json={"rate": "50.00"})
    assert resp.status_code == 200

    resp = await client.get(f"/api/v1/cost-elements/{element['id']}")
    assert resp.json()["source"] == "manual"


async def test_deleting_activity_removes_linked_cost_element(
    client: AsyncClient, project: Project, live_period: Period
):
    activity = await _create_activity(client, project, live_period, "Piling")
    resource = await _create_resource(client, project)
    await client.post("/api/v1/resource-assignments/", json={"activity_id": activity["id"], "resource_id": resource["id"]})
    element = await _linked_element(client, project, live_period)
    assert element is not None

    resp = await client.delete(f"/api/v1/activities/{activity['id']}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/v1/cost-elements/{element['id']}")
    assert resp.status_code == 404


async def test_schedule_linked_element_computes_pv_ev_spi(client: AsyncClient, db, project: Project, live_period: Period):
    """PV is prorated against the activity's own live start/finish, not a
    captured baseline — available as soon as the activity is scheduled, per
    Maro's confirmed P6 domain correction (Session 16): "Set Baseline" drives
    schedule variance, not Planned Value."""
    from datetime import date, datetime, time, timedelta
    import uuid as uuid_mod

    from app.models.activity import Activity

    activity = await _create_activity(client, project, live_period, "Piling", duration_hours=80)  # 10 days
    resource = await _create_resource(client, project, rate="1000")
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })  # budget = 10 days * 100% * 1000 = 10000

    element = await _linked_element(client, project, live_period)
    assert float(element["budget"]) == 10000.0
    assert element["pv"] is not None  # live start/finish already exist from CPM -> no baseline needed

    # Directly set live start/finish spanning today (10 days either side) for a
    # deterministic 50% elapsed fraction — set at the default calendar's day
    # start (08:00), matching the actual instant "today" resolves to as a
    # data date (2026-07-03 fix: data date now compares at full datetime
    # precision, not just calendar date, so a midnight-anchored start would
    # no longer land on a clean 50%).
    db_activity = await db.get(Activity, uuid_mod.UUID(activity["id"]))
    today = date.today()
    db_activity.start = datetime.combine(today - timedelta(days=10), time(8, 0))
    db_activity.finish = datetime.combine(today + timedelta(days=10), time(8, 0))
    await db.commit()
    await db.refresh(db_activity)

    resp = await client.patch(f"/api/v1/cost-elements/{element['id']}", json={"pct_complete": 60})
    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "schedule"     # pct_complete alone doesn't unlink it
    assert float(data["pv"]) == 5000.0      # 50% of 10000
    assert float(data["ev"]) == 6000.0      # 60% of 10000
    assert float(data["sv"]) == 1000.0      # EV - PV
    assert float(data["spi"]) == 1.2        # EV / PV


async def test_deleting_activity_leaves_unlinked_element_in_place(
    client: AsyncClient, project: Project, live_period: Period
):
    activity = await _create_activity(client, project, live_period, "Piling")
    resource = await _create_resource(client, project)
    await client.post("/api/v1/resource-assignments/", json={"activity_id": activity["id"], "resource_id": resource["id"]})
    element = await _linked_element(client, project, live_period)
    await client.patch(f"/api/v1/cost-elements/{element['id']}", json={"budget": "500.00"})  # unlinks it

    resp = await client.delete(f"/api/v1/activities/{activity['id']}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/v1/cost-elements/{element['id']}")
    assert resp.status_code == 200
    assert resp.json()["linked_activity_id"] is None
    assert float(resp.json()["budget"]) == 500.0
