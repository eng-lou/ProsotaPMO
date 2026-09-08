from __future__ import annotations

from httpx import AsyncClient

from app.models.period import Period
from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_resource(client: AsyncClient, project: Project, **overrides) -> dict:
    payload = {"project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "1000"}
    payload.update(overrides)
    resp = await client.post("/api/v1/resources/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _linked_element(client: AsyncClient, project: Project, period: Period) -> dict:
    resp = await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id), "period_id": str(period.id)})
    assert resp.status_code == 200
    linked = [e for e in resp.json() if e["source"] == "schedule"]
    assert len(linked) == 1, linked
    return linked[0]


async def test_fy_breakdown_budget_is_day_weighted_across_activity_span(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod,
):
    """A 10,000 BAC activity running entirely inside one fiscal year (well in
    the past, so this test never depends on which FY "today" happens to
    fall in) should show its whole BAC under that one FY, per Maro's own
    "spread across the year it's scheduled in" ask — real, day-weighted
    from the schedule, not invented."""
    activity = await _create_activity(
        client, project, live_schedule_period, "Piling",
        duration_hours=80,  # 10 days
        constraint_type="ms", constraint_date="2024-06-03T08:00:00",  # pins CPM's own start — fully inside FY24/25
    )
    resource = await _create_resource(client, project)
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })  # BAC = 10 days * 1000/day = 10000

    resp = await client.get("/api/v1/cost-elements/fy-breakdown", params={
        "project_id": str(project.id), "period_id": str(live_period.id),
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    point = next(p for p in body["points"] if p["label"] == "FY24/25")
    assert float(point["budget"]) == 10000.00
    assert point["actuals"] is None  # no baseline captured yet — never invented
    assert point["forecast"] is None


async def test_fy_breakdown_actuals_and_forecast_come_from_a_real_captured_baseline(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod,
):
    """Per Maro: "these should just be saved when baselines exist... I'm not
    saying you should magic any number" — a past FY's Actuals/Forecast come
    verbatim from whichever real CostBaseline was captured in that year,
    never reprofiled or estimated."""
    activity = await _create_activity(
        client, project, live_schedule_period, "Piling",
        duration_hours=80,
        constraint_type="ms", constraint_date="2024-06-03T08:00:00",
    )
    resource = await _create_resource(client, project)
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })
    element = await _linked_element(client, project, live_period)
    await client.patch(f"/api/v1/cost-elements/{element['id']}", json={"actuals": "4000.00", "pct_complete": 50})

    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "July 2024 Snapshot", "baseline_date": "2024-07-01",
    })).json()
    await client.post(f"/api/v1/cost-baselines/{baseline['id']}/assign")

    resp = await client.get("/api/v1/cost-elements/fy-breakdown", params={
        "project_id": str(project.id), "period_id": str(live_period.id),
    })
    assert resp.status_code == 200, resp.text
    point = next(p for p in resp.json()["points"] if p["label"] == "FY24/25")
    assert float(point["actuals"]) == 4000.00
    assert point["actuals_is_ytd"] is False  # a genuinely-past FY, not "as of today"
    # Default 'cpi' method: ev = 10000*0.5 = 5000, eac = bac*ac/ev = 10000*4000/5000 = 8000.
    assert float(point["forecast"]) == 8000.00
    assert point["forecast_is_reprofiled"] is False  # a real recorded snapshot, not an estimate


async def test_fy_breakdown_puts_unlinked_elements_in_the_unscheduled_bucket(
    client: AsyncClient, project: Project, live_period: Period,
):
    """A manual cost element with no linked activity has no real date to
    assign it to any one fiscal year — it must land in the honest
    "unscheduled" bucket, never an arbitrary guessed year."""
    await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "description": "Contingency", "budget": "50000.00",
    })

    resp = await client.get("/api/v1/cost-elements/fy-breakdown", params={
        "project_id": str(project.id), "period_id": str(live_period.id),
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert float(body["unscheduled_budget"]) == 50000.00
    for point in body["points"]:
        assert point["budget"] is None
