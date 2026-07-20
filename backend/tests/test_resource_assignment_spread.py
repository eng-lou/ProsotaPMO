from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod

# Same Monday anchor and standard calendar (Mon-Fri 08:00-17:00, 12:00-13:00
# lunch, net 8h/day) as test_scheduling_cpm.py.
_MONDAY = date(2025, 6, 2)


async def _anchor(db: AsyncSession, period: SchedulePeriod) -> None:
    period.start_date = _MONDAY
    await db.commit()


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": "Excavation"}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_resource(client: AsyncClient, project: Project, **overrides) -> dict:
    payload = {
        "project_id": str(project.id), "resource_type": "labour", "name": "Electrician",
        "unit": "day", "rate": "500", "max_hours_per_day": "8",
    }
    payload.update(overrides)
    resp = await client.post("/api/v1/resources/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_assignment(client: AsyncClient, activity: dict, resource: dict, **overrides) -> dict:
    payload = {"activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100"}
    payload.update(overrides)
    resp = await client.post("/api/v1/resource-assignments/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _get_spread(client: AsyncClient, resource_id: str, start: str, end: str) -> dict:
    resp = await client.get("/api/v1/resource-assignment-spreads/", params={
        "resource_id": resource_id, "start": start, "end": end,
    })
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_default_hours_match_calendar_and_utilisation(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period, duration_hours=40)
    resource = await _create_resource(client, project, max_hours_per_day="8")
    await _create_assignment(client, activity, resource, utilisation_pct="50")

    # Mon 02 -> Fri 06 June: 5 working days, no weekend inside this range.
    data = await _get_spread(client, resource["id"], "2025-06-02", "2025-06-07")
    cells = {c["date"]: c for c in data["cells"]}
    assert len(cells) == 5
    for c in cells.values():
        assert float(c["hours"]) == 4.0  # 8h day x 50% utilisation
        assert c["is_override"] is False

    days = {d["date"]: d for d in data["days"]}
    assert float(days["2025-06-02"]["capacity"]) == 8.0


async def test_default_hours_use_resource_max_hours_not_calendar_hours(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """2026-07-08, per Maro: demand/capacity are driven by the resource's own
    max_hours_per_day, not the calendar's own (possibly different) working-
    hours count — a resource capped at 6h/day should show 6h (x utilisation),
    not the standard calendar's 8h, even though every day in range is a full
    calendar working day."""
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period, duration_hours=40)
    resource = await _create_resource(client, project, max_hours_per_day="6")
    await _create_assignment(client, activity, resource, utilisation_pct="50")

    data = await _get_spread(client, resource["id"], "2025-06-02", "2025-06-07")
    cells = {c["date"]: c for c in data["cells"]}
    for c in cells.values():
        assert float(c["hours"]) == 3.0  # 6h max_hours_per_day x 50% utilisation, not 8h x 50%

    days = {d["date"]: d for d in data["days"]}
    assert float(days["2025-06-02"]["capacity"]) == 6.0


async def test_no_demand_outside_activity_span(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period, duration_hours=8)  # Mon only
    resource = await _create_resource(client, project)
    await _create_assignment(client, activity, resource)

    data = await _get_spread(client, resource["id"], "2025-06-02", "2025-06-07")
    cells = {c["date"]: c for c in data["cells"]}
    assert float(cells["2025-06-02"]["hours"]) == 8.0
    assert float(cells["2025-06-03"]["hours"]) == 0.0


async def test_override_wins_over_default(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period, duration_hours=40)
    resource = await _create_resource(client, project)
    assignment = await _create_assignment(client, activity, resource, utilisation_pct="50")

    resp = await client.patch("/api/v1/resource-assignment-spreads/", json={
        "resource_assignment_id": assignment["id"],
        "period_start": "2025-06-02", "period_end": "2025-06-02", "total_hours": "6.5",
    })
    assert resp.status_code == 204, resp.text

    data = await _get_spread(client, resource["id"], "2025-06-02", "2025-06-07")
    cells = {c["date"]: c for c in data["cells"]}
    assert float(cells["2025-06-02"]["hours"]) == 6.5
    assert cells["2025-06-02"]["is_override"] is True
    assert float(cells["2025-06-03"]["hours"]) == 4.0  # untouched, still default
    assert cells["2025-06-03"]["is_override"] is False


async def test_set_spread_range_distributes_evenly_across_working_days(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period, duration_hours=40)
    resource = await _create_resource(client, project)
    assignment = await _create_assignment(client, activity, resource)

    # Mon 02 -> Fri 06 = 5 working days; 100h total -> 20h/day.
    resp = await client.patch("/api/v1/resource-assignment-spreads/", json={
        "resource_assignment_id": assignment["id"],
        "period_start": "2025-06-02", "period_end": "2025-06-06", "total_hours": "100",
    })
    assert resp.status_code == 204, resp.text

    data = await _get_spread(client, resource["id"], "2025-06-02", "2025-06-07")
    cells = {c["date"]: c for c in data["cells"]}
    total = sum(float(c["hours"]) for c in cells.values())
    assert total == 100.0
    assert all(c["is_override"] for c in cells.values() if c["date"] != "2025-06-07")


async def test_set_spread_range_clips_to_activity_current_span(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    # Only Mon 02 (8h, one working day) is in span.
    activity = await _create_activity(client, project, live_schedule_period, duration_hours=8)
    resource = await _create_resource(client, project)
    assignment = await _create_assignment(client, activity, resource)

    # Requested range extends well past the activity's actual Finish — should
    # clip down to just the activity's own single working day, not error.
    resp = await client.patch("/api/v1/resource-assignment-spreads/", json={
        "resource_assignment_id": assignment["id"],
        "period_start": "2025-06-02", "period_end": "2025-06-13", "total_hours": "5",
    })
    assert resp.status_code == 204, resp.text

    data = await _get_spread(client, resource["id"], "2025-06-02", "2025-06-14")
    cells = {c["date"]: c for c in data["cells"]}
    assert float(cells["2025-06-02"]["hours"]) == 5.0
    assert cells["2025-06-02"]["is_override"] is True
    # Nothing else got an override row — the activity was never active there.
    assert not any(c["is_override"] for d, c in cells.items() if d != "2025-06-02")


async def test_set_spread_range_rejects_range_entirely_outside_span(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period, duration_hours=8)  # Mon only
    resource = await _create_resource(client, project)
    assignment = await _create_assignment(client, activity, resource)

    resp = await client.patch("/api/v1/resource-assignment-spreads/", json={
        "resource_assignment_id": assignment["id"],
        "period_start": "2025-07-01", "period_end": "2025-07-31", "total_hours": "10",
    })
    assert resp.status_code == 422


async def test_recalculate_costs_updates_utilisation_and_budget(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period, duration_hours=40)
    resource = await _create_resource(client, project, rate="500")
    assignment = await _create_assignment(client, activity, resource, utilisation_pct="50")
    original_budget = float(assignment["budget"])

    # Bump every working day to full 8h (100% utilisation instead of 50%).
    await client.patch("/api/v1/resource-assignment-spreads/", json={
        "resource_assignment_id": assignment["id"],
        "period_start": "2025-06-02", "period_end": "2025-06-06", "total_hours": "40",
    })

    resp = await client.post(f"/api/v1/resource-assignment-spreads/{assignment['id']}/recalculate-costs")
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert float(updated["utilisation_pct"]) == 100.0
    assert float(updated["budget"]) > original_budget


async def test_get_spread_scoped_per_resource(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period, duration_hours=40)
    resource_a = await _create_resource(client, project, name="Electrician")
    resource_b = await _create_resource(client, project, name="Plumber")
    await _create_assignment(client, activity, resource_a)
    await _create_assignment(client, activity, resource_b)

    data = await _get_spread(client, resource_a["id"], "2025-06-02", "2025-06-07")
    assignment_ids = {c["assignment_id"] for c in data["cells"]}
    assert len(assignment_ids) == 1


async def test_material_resource_rejected(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    resource = await _create_resource(client, project, resource_type="material", unit="m3", rate="20")
    resp = await client.get("/api/v1/resource-assignment-spreads/", params={
        "resource_id": resource["id"], "start": "2025-06-02", "end": "2025-06-07",
    })
    assert resp.status_code == 422


async def test_bulk_fetch_matches_individual_calls(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """The batch endpoint (2026-07-17 perf fix, replacing the Resources tab's
    old one-request-per-resource pattern) must return exactly what N
    individual GET calls would have — same calendar-driven defaults, same
    overrides, just built off one shared calendar lookup instead of N."""
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period, duration_hours=40)
    resource_a = await _create_resource(client, project, name="Electrician", max_hours_per_day="8")
    resource_b = await _create_resource(client, project, name="Plumber", max_hours_per_day="6")
    await _create_assignment(client, activity, resource_a, utilisation_pct="50")
    await _create_assignment(client, activity, resource_b, utilisation_pct="100")

    individual_a = await _get_spread(client, resource_a["id"], "2025-06-02", "2025-06-07")
    individual_b = await _get_spread(client, resource_b["id"], "2025-06-02", "2025-06-07")

    resp = await client.post("/api/v1/resource-assignment-spreads/bulk-fetch", json={
        "resource_ids": [resource_a["id"], resource_b["id"]],
        "start": "2025-06-02", "end": "2025-06-07",
    })
    assert resp.status_code == 200, resp.text
    batch = resp.json()["spreads"]

    assert batch[resource_a["id"]] == individual_a
    assert batch[resource_b["id"]] == individual_b


async def test_bulk_fetch_silently_skips_invalid_resource_ids(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """A material resource (not time-based, GET 422s on it individually — see
    test_material_resource_rejected above) or a resource_id that doesn't
    exist at all must not fail the whole batch — same "isolate the bad
    entry" reasoning the frontend's own per-resource Promise.allSettled had
    before this endpoint existed. Missing from the response entirely, not a
    422/404 for the whole request."""
    material = await _create_resource(client, project, resource_type="material", unit="m3", rate="20")
    labour = await _create_resource(client, project, name="Electrician")
    missing_id = "00000000-0000-0000-0000-000000000000"

    resp = await client.post("/api/v1/resource-assignment-spreads/bulk-fetch", json={
        "resource_ids": [material["id"], labour["id"], missing_id],
        "start": "2025-06-02", "end": "2025-06-07",
    })
    assert resp.status_code == 200, resp.text
    batch = resp.json()["spreads"]

    assert material["id"] not in batch
    assert missing_id not in batch
    assert labour["id"] in batch


async def test_bulk_fetch_empty_resource_ids(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    resp = await client.post("/api/v1/resource-assignment-spreads/bulk-fetch", json={
        "resource_ids": [], "start": "2025-06-02", "end": "2025-06-07",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["spreads"] == {}
