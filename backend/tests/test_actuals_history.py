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


async def test_actuals_history_returns_one_row_per_snapshot_per_element(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod,
):
    """2026-09-08, per Maro: "in the past there is budget and actuals and
    even forecast bars... in future there is budgeted and forecast but no
    actuals" — Resource Usage Profile/Resource Tracking need a REAL history
    of BAC/AC/EAC over time to derive per-period Actual/Forecast from,
    never an invented smooth curve. This confirms two real captured
    baselines, at two different points of progress, both show up
    chronologically with correctly-derived EAC (default 'cpi' method)."""
    activity = await _create_activity(
        client, project, live_schedule_period, "Piling",
        duration_hours=80, constraint_type="ms", constraint_date="2024-06-03T08:00:00",
    )
    resource = await _create_resource(client, project)
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })  # BAC = 10 days * 1000/day = 10000
    element = await _linked_element(client, project, live_period)

    # First snapshot: 25% done, £2,000 spent.
    await client.patch(f"/api/v1/cost-elements/{element['id']}", json={"actuals": "2000.00", "pct_complete": 25})
    baseline1 = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Week 1", "baseline_date": "2024-06-05",
    })).json()
    await client.post(f"/api/v1/cost-baselines/{baseline1['id']}/assign")

    # Second snapshot: 50% done, £4,000 spent (right on budget: 10000*0.5=5000 vs 4000 spent -> ahead of cost).
    await client.patch(f"/api/v1/cost-elements/{element['id']}", json={"actuals": "4000.00", "pct_complete": 50})
    baseline2 = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Week 2", "baseline_date": "2024-06-10",
    })).json()
    await client.post(f"/api/v1/cost-baselines/{baseline2['id']}/assign")

    resp = await client.get("/api/v1/cost-elements/actuals-history", params={
        "project_id": str(project.id), "period_id": str(live_period.id),
    })
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert len(items) == 2

    week1 = next(i for i in items if i["baseline_date"] == "2024-06-05")
    assert week1["linked_activity_id"] == activity["id"]
    assert float(week1["bac"]) == 10000.00
    assert float(week1["ac"]) == 2000.00
    # ev = 10000*0.25 = 2500, eac = bac*ac/ev = 10000*2000/2500 = 8000
    assert float(week1["eac"]) == 8000.00

    week2 = next(i for i in items if i["baseline_date"] == "2024-06-10")
    assert float(week2["ac"]) == 4000.00
    # ev = 10000*0.5 = 5000, eac = 10000*4000/5000 = 8000
    assert float(week2["eac"]) == 8000.00

    # Chronological order.
    assert [i["baseline_date"] for i in items] == ["2024-06-05", "2024-06-10"]


async def test_actuals_history_empty_when_no_baselines_captured(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod,
):
    """Per Maro: "these should just be saved when baselines exist... I'm
    not saying you should magic any number" — no captured baseline means no
    history at all, not a fabricated one."""
    activity = await _create_activity(
        client, project, live_schedule_period, "Piling",
        duration_hours=80, constraint_type="ms", constraint_date="2024-06-03T08:00:00",
    )
    resource = await _create_resource(client, project)
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })

    resp = await client.get("/api/v1/cost-elements/actuals-history", params={
        "project_id": str(project.id), "period_id": str(live_period.id),
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["items"] == []


async def test_actuals_history_excludes_manual_elements(
    client: AsyncClient, project: Project, live_period: Period,
):
    """A manual cost element (no linked activity) has no resource/rate a
    frontend chart could convert its history to hours by, and no per-period
    date info to bucket it against — excluded entirely, same as the Fiscal
    Year panel's own 'unscheduled' rule."""
    el = (await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "description": "Contingency", "budget": "5000.00", "actuals": "1000.00", "pct_complete": 20,
    })).json()
    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Snapshot", "baseline_date": "2024-06-05",
    })).json()
    await client.post(f"/api/v1/cost-baselines/{baseline['id']}/assign")

    resp = await client.get("/api/v1/cost-elements/actuals-history", params={
        "project_id": str(project.id), "period_id": str(live_period.id),
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["items"] == []
