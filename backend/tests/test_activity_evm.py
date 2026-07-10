from __future__ import annotations

import uuid as uuid_mod
from datetime import date, datetime, time, timedelta

from httpx import AsyncClient

from app.models.activity import Activity
from app.models.period import Period
from app.models.schedule_period import SchedulePeriod
from app.models.project import Project


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": task_name}
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


async def test_activity_with_no_resources_has_null_evm(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity = await _create_activity(client, project, live_schedule_period, "Unresourced task")
    resp = await client.get(f"/api/v1/activities/{activity['id']}")
    assert resp.status_code == 200
    data = resp.json()
    for field in ("bac", "ac", "pv", "ev", "cv", "sv", "cpi", "spi", "eac", "etc"):
        assert data[field] is None, field


async def test_activity_evm_mirrors_linked_cost_element(
    client: AsyncClient, db, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """Scheduling's EVM columns must show exactly what Cost Plan shows for the
    same resourced activity — same numbers, same source of truth, never a second
    independently-derived set (see app/services/activity.py:_attach_evm_fields).
    PV is prorated against the activity's own live start/finish, not a captured
    baseline (Maro's confirmed P6 correction, Session 16)."""
    activity = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=80)  # 10 days
    resource = await _create_resource(client, project, rate="1000")
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })  # budget (BAC) = 10 days * 100% * 1000 = 10000

    resp = await client.get(f"/api/v1/activities/{activity['id']}")
    data = resp.json()
    assert float(data["bac"]) == 10000.0
    assert data["ac"] is None    # no actuals recorded yet
    assert data["pv"] is not None  # live start/finish already exist from CPM — no baseline needed

    # % Complete is set via the activity (Scheduling's own workflow) — it must
    # propagate to the linked Cost Plan line automatically (app/services/
    # cost_sync.py:sync_cost_element_pct_complete), not require a second,
    # separate edit in Cost Plan, else the two screens' EVM silently diverge.
    # Done before forcing deterministic dates below, since this PATCH re-runs
    # the CPM engine (recompute_schedule), which would overwrite a manually-set
    # start/finish back to their real, duration-derived values.
    resp = await client.patch(f"/api/v1/activities/{activity['id']}", json={"pct_complete": "60"})
    assert resp.status_code == 200

    element = await _linked_element(client, project, live_period)
    assert element["pct_complete"] == 60

    # Deterministic 50% elapsed fraction: live start/finish span 10 days either
    # side of today, set at the default calendar's day start (08:00) to match
    # the actual instant "today" resolves to as a data date (2026-07-03 fix —
    # data date now compares at full datetime precision, not just calendar
    # date, so a midnight-anchored start would no longer land on a clean 50%).
    # Set directly (bypassing the CPM engine) after the pct_complete update
    # above so nothing recomputes them again afterwards.
    db_activity = await db.get(Activity, uuid_mod.UUID(activity["id"]))
    today = date.today()
    db_activity.start = datetime.combine(today - timedelta(days=10), time(8, 0))
    db_activity.finish = datetime.combine(today + timedelta(days=10), time(8, 0))
    await db.commit()
    # Same session as the test client (see conftest.py) — without this refresh, the
    # identity-mapped Activity's other attributes (e.g. updated_at) stay expired
    # from the commit above, and a later unrelated request reading this same
    # instance raises MissingGreenlet trying to lazily reload them outside an
    # awaited context (same class of issue documented in
    # app/services/activity.py:_recompute_hierarchy).
    await db.refresh(db_activity)

    resp = await client.patch(f"/api/v1/cost-elements/{element['id']}", json={"actuals": "5000"})
    assert resp.status_code == 200
    cost_element = resp.json()
    assert cost_element["pct_complete"] == 60

    resp = await client.get(f"/api/v1/activities/{activity['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert float(data["bac"]) == float(cost_element["budget"]) == 10000.0
    assert float(data["ac"]) == 5000.0
    assert float(data["pv"]) == float(cost_element["pv"]) == 5000.0   # 50% of 10000
    assert float(data["ev"]) == float(cost_element["ev"]) == 6000.0   # 60% of 10000
    assert float(data["sv"]) == float(cost_element["sv"]) == 1000.0   # EV - PV
    assert float(data["spi"]) == float(cost_element["spi"]) == 1.2    # EV / PV
    assert float(data["cv"]) == float(cost_element["cv"]) == 1000.0   # EV - AC
    assert float(data["cpi"]) == float(cost_element["cpi"]) == 1.2    # EV / AC
    assert float(data["eac"]) == float(cost_element["eac"]) == round(10000 / 1.2, 2)
    assert float(data["etc"]) == float(cost_element["etc"]) == round(float(data["eac"]) - 5000.0, 2)


async def test_pv_tracks_period_data_date_not_wall_clock(
    client: AsyncClient, db, project: Project, live_schedule_period: SchedulePeriod
):
    """PV must prorate against the schedule period's own data date
    (scheduling_cpm.data_date_for_period, moved by Reschedule) rather than the
    real wall-clock date — caught by Maro testing Reschedule and seeing PV not
    move. Isolates the data-date plumbing itself: start/finish are forced
    directly (not via CPM/Reschedule) so this doesn't depend on whether a given
    activity's own dates happen to shift when the anchor does."""
    activity = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=80)  # 10 days
    resource = await _create_resource(client, project, rate="1000")
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })  # BAC = 10 days * 100% * 1000 = 10000

    # Start/finish set at the default calendar's day start (08:00), matching
    # the actual instant "today" resolves to as a data date (2026-07-03 fix —
    # data date now compares at full datetime precision, not just calendar
    # date, so a midnight-anchored start here would no longer land exactly on
    # the data date and this test would stop isolating what it's meant to).
    db_activity = await db.get(Activity, uuid_mod.UUID(activity["id"]))
    today = date.today()
    db_activity.start = datetime.combine(today, time(8, 0))
    db_activity.finish = datetime.combine(today + timedelta(days=10), time(8, 0))
    await db.commit()
    await db.refresh(db_activity)

    resp = await client.get(f"/api/v1/activities/{activity['id']}")
    assert float(resp.json()["pv"]) == 0.0  # data date defaults to today == start -> 0% elapsed

    db_period = await db.get(SchedulePeriod, live_schedule_period.id)
    db_period.start_date = today + timedelta(days=5)  # data date moved 5 days forward, e.g. via Reschedule
    await db.commit()
    await db.refresh(db_period)

    resp = await client.get(f"/api/v1/activities/{activity['id']}")
    assert resp.status_code == 200
    assert float(resp.json()["pv"]) == 5000.0  # 5 of 10 days elapsed against the new data date -> 50% of 10000


async def test_duration_pct_complete_is_independent_of_resources(
    client: AsyncClient, db, project: Project, live_schedule_period: SchedulePeriod):
    """Duration % Complete (how far along its own schedule an activity should
    be by the data date) needs no resources/BAC — a pure schedule figure,
    distinct from the resource-gated EVM fields. Requested by Maro as a
    transparency aid showing exactly what PV is prorated from."""
    activity = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=80)  # 10 days
    # Set at the default calendar's day start (08:00), matching the actual
    # instant "today" resolves to as a data date (2026-07-03 fix — see
    # test_pv_tracks_period_data_date_not_wall_clock's own comment).
    db_activity = await db.get(Activity, uuid_mod.UUID(activity["id"]))
    today = date.today()
    db_activity.start = datetime.combine(today - timedelta(days=3), time(8, 0))
    db_activity.finish = datetime.combine(today + timedelta(days=7), time(8, 0))
    await db.commit()
    await db.refresh(db_activity)

    resp = await client.get(f"/api/v1/activities/{activity['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["bac"] is None  # no resources — EVM fields stay null
    assert float(data["duration_pct_complete"]) == 30.0  # 3 of 10 days elapsed


async def test_duration_pct_complete_is_zero_for_brand_new_same_day_activity(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    """Regression (Maro, 2026-07-03): a freshly-created 1-day activity
    starting "now" read as 100% Duration % Complete the instant it was
    created, since its start and finish both fell on the same calendar date
    and the old date-only comparison treated "data_date >= finish_date" as
    true from hour zero. A brand-new activity anchored to today should read
    0% — it's just starting, not finished — matching the fix in
    app/services/scheduling_cpm.py:elapsed_duration_fraction."""
    activity = await _create_activity(client, project, live_schedule_period, "New Activity", duration_hours=8)  # 1 day
    assert activity["start"][:10] == activity["finish"][:10]  # same calendar day, the exact case that broke
    assert float(activity["duration_pct_complete"]) == 0.0


async def test_activity_list_includes_evm(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    activity = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=8)
    resource = await _create_resource(client, project, rate="100")
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })  # budget = 1 day * 100% * 100 = 100

    resp = await client.get("/api/v1/activities/", params={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id),
    })
    assert resp.status_code == 200
    row = next(a for a in resp.json() if a["id"] == activity["id"])
    assert float(row["bac"]) == 100.0
