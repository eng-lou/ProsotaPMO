from __future__ import annotations

import uuid as uuid_mod
from datetime import date, datetime, time, timedelta

from httpx import AsyncClient

from app.models.activity import Activity
from app.models.period import Period
from app.models.schedule_period import SchedulePeriod
from app.models.project import Project
from app.services.scheduling_cpm import _build_calendar_lookup, elapsed_duration_fraction


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


async def _linked_element_for_activity(client: AsyncClient, project: Project, period: Period, activity_id: str) -> dict:
    resp = await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id), "period_id": str(period.id)})
    assert resp.status_code == 200
    matches = [e for e in resp.json() if e["source"] == "schedule" and e["linked_activity_id"] == activity_id]
    assert len(matches) == 1, matches
    return matches[0]


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

    # Deterministic 50% elapsed fraction: PV is now working-day-prorated, not
    # calendar-time (2026-09-04, per Maro — exact P6 interoperability, see
    # elapsed_duration_fraction's own header), so both the activity's own
    # span and the data date are pinned to fixed dates instead of "today"
    # ± N days — a calendar-day-relative span's own working-day ratio
    # depends on which weekday "today" happens to be, which would make this
    # test flaky. _count_working_days counts BOTH endpoints inclusive, so
    # 2024-01-01 (Monday) to 2024-01-26 (Friday, 4 full Mon-Fri weeks later)
    # is exactly 20 working days; 2024-01-12 (also a Friday, 2 weeks in) is
    # exactly 10 — verified directly against a standalone count, not by
    # hand, before picking these (a Monday-to-Monday span double-counts one
    # extra boundary day and isn't a clean multiple of 5). Set directly
    # (bypassing the CPM engine) after the pct_complete update above so
    # nothing recomputes them again afterwards.
    db_activity = await db.get(Activity, uuid_mod.UUID(activity["id"]))
    db_activity.start = datetime(2024, 1, 1, 8, 0)
    db_activity.finish = datetime(2024, 1, 26, 8, 0)
    db_schedule_period = await db.get(SchedulePeriod, uuid_mod.UUID(activity["schedule_period_id"]))
    db_schedule_period.start_date = date(2024, 1, 12)
    # Cost Plan's own PV read (cost_element["pv"] below) uses Cost/Risk/ICD's
    # own separate Period.start_date, not SchedulePeriod's (two genuinely
    # independent data-date anchors — see scheduling_cpm.py:data_date_
    # time_for_period's own header) — both need pinning or the two sides
    # this test is meant to cross-check would read different data dates.
    db_live_period = await db.get(Period, live_period.id)
    db_live_period.start_date = date(2024, 1, 12)
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
    new_data_date = today + timedelta(days=5)
    db_period.start_date = new_data_date  # data date moved 5 days forward, e.g. via Reschedule
    await db.commit()
    await db.refresh(db_period)

    # Expected PV computed via the real production formula, not a hardcoded
    # literal — PV is now working-day-prorated (2026-09-04, per Maro — exact
    # P6 interoperability), so "5 of 10 calendar days elapsed" no longer maps
    # to a fixed 50% regardless of which weekday "today" (this test's own
    # anchor) happens to be. What this test actually verifies — that PV
    # moved because the *period's* data date moved, not real wall-clock time
    # — doesn't need a hardcoded ratio to prove.
    await db.refresh(db_activity)
    lookup = await _build_calendar_lookup(db, project.id)
    calendar = lookup.resolve(db_activity)
    expected_fraction = elapsed_duration_fraction(
        lookup, calendar, db_activity.start, db_activity.finish, datetime.combine(new_data_date, time(8, 0)),
    )
    expected_pv = round(10000 * float(expected_fraction), 2)

    resp = await client.get(f"/api/v1/activities/{activity['id']}")
    assert resp.status_code == 200
    assert float(resp.json()["pv"]) == expected_pv
    assert expected_pv > 0.0  # moved off the earlier 0.0 — the actual thing under test


async def test_schedule_pct_complete_is_independent_of_resources(
    client: AsyncClient, db, project: Project, live_schedule_period: SchedulePeriod):
    """Schedule % Complete (renamed from Duration % Complete, 2026-09-03 —
    how far along its own schedule an activity should be by the data date)
    needs no resources/BAC — a pure schedule figure, distinct from the
    resource-gated EVM fields. Requested by Maro as a transparency aid
    showing exactly what PV is prorated from."""
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

    # Expected % computed via the real production formula, not a hardcoded
    # "3 of 10 days" literal — Schedule % Complete is now working-day-
    # prorated (2026-09-04, per Maro — exact P6 interoperability), so the
    # real ratio depends on which weekday "today" (this test's own anchor)
    # happens to be, same reasoning as test_pv_tracks_period_data_date_not_wall_clock.
    lookup = await _build_calendar_lookup(db, project.id)
    calendar = lookup.resolve(db_activity)
    expected_fraction = elapsed_duration_fraction(
        lookup, calendar, db_activity.start, db_activity.finish, datetime.combine(today, time(8, 0)),
    )
    expected_pct = round(float(expected_fraction) * 100, 2)

    resp = await client.get(f"/api/v1/activities/{activity['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["bac"] is None  # no resources — EVM fields stay null
    assert float(data["schedule_pct_complete"]) == expected_pct


async def test_schedule_pct_complete_is_zero_for_brand_new_same_day_activity(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    """Regression (Maro, 2026-07-03): a freshly-created 1-day activity
    starting "now" read as 100% Schedule % Complete the instant it was
    created, since its start and finish both fell on the same calendar date
    and the old date-only comparison treated "data_date >= finish_date" as
    true from hour zero. A brand-new activity anchored to today should read
    0% — it's just starting, not finished — matching the fix in
    app/services/scheduling_cpm.py:elapsed_duration_fraction."""
    activity = await _create_activity(client, project, live_schedule_period, "New Activity", duration_hours=8)  # 1 day
    assert activity["start"][:10] == activity["finish"][:10]  # same calendar day, the exact case that broke
    assert float(activity["schedule_pct_complete"]) == 0.0


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


async def test_wbs_summary_rolls_up_evm_from_children_not_averaged(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """A WBS summary/root activity is never itself linked to a Cost Element —
    only leaf tasks get resourced — so its own EVM used to sit permanently
    blank (Maro: "rollup the bac and eac and etc"). BAC/AC/PV/EV must sum
    across children (the only EVM quantities PMBOK treats as additive across
    a WBS); every other figure (CV/SV/CPI/SPI/EAC/ETC) must be *recomputed*
    from those summed totals, never averaged from the children's own
    ratios — this test picks two children with deliberately different CPI
    (0.5 and 10/9) specifically so an incorrect "average the ratios"
    implementation would produce a materially different, easily-caught wrong
    number instead of accidentally landing close to the correct cumulative
    EV/AC rollup."""
    wbs = await _create_activity(client, project, live_schedule_period, "Structure", activity_type="wbs_summary")

    # Child A: BAC = 1 day * 100% * 100/day = 100.
    child_a = await _create_activity(client, project, live_schedule_period, "Task A", parent_id=wbs["id"], duration_hours=8)
    resource_a = await _create_resource(client, project, rate="100")
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": child_a["id"], "resource_id": resource_a["id"], "utilisation_pct": "100",
    })
    # Child B: BAC = 10 days * 100% * 1000/day = 10000.
    child_b = await _create_activity(client, project, live_schedule_period, "Task B", parent_id=wbs["id"], duration_hours=80)
    resource_b = await _create_resource(client, project, rate="1000")
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": child_b["id"], "resource_id": resource_b["id"], "utilisation_pct": "100",
    })

    await client.patch(f"/api/v1/activities/{child_a['id']}", json={"pct_complete": "100"})
    await client.patch(f"/api/v1/activities/{child_b['id']}", json={"pct_complete": "100"})
    element_a = await _linked_element_for_activity(client, project, live_period, child_a["id"])
    element_b = await _linked_element_for_activity(client, project, live_period, child_b["id"])
    await client.patch(f"/api/v1/cost-elements/{element_a['id']}", json={"actuals": "200"})   # EV 100, AC 200 -> CPI 0.5
    await client.patch(f"/api/v1/cost-elements/{element_b['id']}", json={"actuals": "9000"})  # EV 10000, AC 9000 -> CPI 10/9

    resp = await client.get("/api/v1/activities/", params={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id),
    })
    assert resp.status_code == 200
    rows = {row["id"]: row for row in resp.json()}
    parent = rows[wbs["id"]]

    assert float(parent["bac"]) == 100.0 + 10000.0
    assert float(parent["ac"]) == 200.0 + 9000.0
    assert float(parent["ev"]) == 100.0 + 10000.0
    assert float(parent["cv"]) == (100.0 + 10000.0) - (200.0 + 9000.0)

    # Cumulative CPI = total EV / total AC, NOT a mean of the children's own
    # CPI (0.5 and 10/9 averages to ~0.806 — a badly wrong rollup that
    # understates this WBS's real, dollar-weighted cost performance, which
    # is actually much closer to on-budget since the $10000 child dominates).
    correct_cpi = round((100.0 + 10000.0) / (200.0 + 9000.0), 4)
    wrong_averaged_cpi = round((0.5 + 10 / 9) / 2, 4)
    assert abs(float(parent["cpi"]) - correct_cpi) < 0.001
    assert abs(float(parent["cpi"]) - wrong_averaged_cpi) > 0.05

    # EAC is the one rollup figure that IS additive (2026-09-04, per Maro's
    # own P6 comparison — real P6 data confirmed P6 itself sums each work
    # package's own EAC to roll up, rather than reapplying one blended
    # portfolio-wide CPI to the whole remaining budget the way this test
    # used to assert): the parent's own eac must equal the sum of its
    # children's own eac, not (total bac) / (aggregate cpi) — those two are
    # only the same number when every child happens to share the exact same
    # CPI, which the 0.5-vs-10/9 setup above specifically avoids.
    child_a_row = rows[child_a["id"]]
    child_b_row = rows[child_b["id"]]
    assert float(parent["eac"]) == round(float(child_a_row["eac"]) + float(child_b_row["eac"]), 2)
    wrong_blended_eac = round((100.0 + 10000.0) / correct_cpi, 2)
    assert abs(float(parent["eac"]) - wrong_blended_eac) > 0.1


async def test_wbs_summary_with_no_costed_children_stays_null(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    """No child anywhere in the subtree has a resourced BAC — the WBS summary
    must stay blank, not roll up to a false £0 (same "leave it blank rather
    than fake a number" rule every other EVM field in this codebase follows)."""
    wbs = await _create_activity(client, project, live_schedule_period, "Structure", activity_type="wbs_summary")
    await _create_activity(client, project, live_schedule_period, "Task A", parent_id=wbs["id"], duration_hours=8)

    resp = await client.get("/api/v1/activities/", params={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id),
    })
    assert resp.status_code == 200
    row = next(a for a in resp.json() if a["id"] == wbs["id"])
    for field in ("bac", "ac", "pv", "ev", "cv", "sv", "cpi", "spi", "eac", "etc"):
        assert row[field] is None, field
