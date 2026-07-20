from __future__ import annotations

from datetime import datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.period import Period
from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _set_computed_fields(db: AsyncSession, activity_id: str, **fields) -> None:
    """is_critical/sub_is_critical/variance_days/finish/bl_finish are never
    accepted as API input (server-computed by scheduling_cpm) — set directly,
    same as test_scheduling_quality_subproject_scope.py's own _anchor helper
    does for period.start_date."""
    activity = await db.get(Activity, activity_id)
    for k, v in fields.items():
        setattr(activity, k, v)
    await db.commit()


async def _create_risk(client: AsyncClient, project: Project, period: Period, title: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "title": title}
    payload.update(overrides)
    resp = await client.post("/api/v1/risks/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_icd_item(client: AsyncClient, project: Project, period: Period, item_type: str, title: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "item_type": item_type, "title": title}
    payload.update(overrides)
    resp = await client.post("/api/v1/icd-items/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_cost_element(client: AsyncClient, project: Project, period: Period, description: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "description": description}
    payload.update(overrides)
    resp = await client.post("/api/v1/cost-elements/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _overview_params(project: Project, period: Period, schedule_period: SchedulePeriod, **extra) -> dict:
    params = {
        "project_id": str(project.id),
        "period_id": str(period.id),
        "schedule_period_id": str(schedule_period.id),
    }
    params.update(extra)
    return params


async def test_kpis_count_open_issues_and_changes_only(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    await _create_icd_item(client, project, live_period, "issue", "Open issue")
    closed_issue = await _create_icd_item(client, project, live_period, "issue", "Closed issue")
    await client.patch(f"/api/v1/icd-items/{closed_issue['id']}", json={"status": "closed"})
    await _create_icd_item(client, project, live_period, "change", "Open change")
    await _create_icd_item(client, project, live_period, "decision", "A decision")  # neither issue nor change

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    assert resp.status_code == 200, resp.text
    kpis = resp.json()["kpis"]
    assert kpis["open_issues"] == 1
    assert kpis["open_changes"] == 1
    # No cost elements exist yet — every EVM figure must stay null, never a fake number.
    assert kpis["schedule_spi"] is None
    assert kpis["bac"] is None
    assert kpis["eac"] is None
    assert kpis["cpi"] is None


async def test_planned_finish_works_without_a_single_top_level_wbs_root(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod, live_period: Period
):
    """Regression: planned_finish used to only look at wbs_role == 'P'
    activities, which stayed empty (and the KPI blank) for any schedule made
    of several independent top-level branches rather than one enclosing
    "Programme" root — exactly what a P6/IFC-imported schedule often looks
    like. It should read the whole network's own latest finish instead."""
    a = await _create_activity(client, project, live_schedule_period, "Branch A")
    b = await _create_activity(client, project, live_schedule_period, "Branch B")
    await _set_computed_fields(db, a["id"], finish=datetime(2026, 6, 1))
    await _set_computed_fields(db, b["id"], finish=datetime(2027, 10, 20))

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    assert resp.json()["kpis"]["planned_finish"] == "2027-10-20T00:00:00"


async def test_bac_eac_cpi_rollup_across_fixed_and_percentage_elements(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    # Fixed element: BAC 100,000, AC 40,000, 50% complete -> EV 50,000.
    await _create_cost_element(client, project, live_period, "Substructure", budget="100000", actuals="40000", pct_complete=50)
    # Percentage element (10% of the fixed subtotal above): computed_budget 10,000,
    # computed_actuals 4,000, same 50% complete -> EV 5,000.
    await _create_cost_element(client, project, live_period, "Prelims", element_type="percentage", rate="0.10", pct_complete=50)

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    kpis = resp.json()["kpis"]
    # BAC = 100,000 + 10,000 = 110,000. AC = 40,000 + 4,000 = 44,000. EV = 50,000 + 5,000 = 55,000.
    # CPI = EV/AC = 55,000/44,000 = 1.25. EAC = BAC/CPI = 110,000/1.25 = 88,000.00.
    assert kpis["bac"] == "110000.00"
    assert kpis["cpi"] == "1.2500"
    assert kpis["eac"] == "88000.00"


async def test_schedule_buckets_delayed_beats_critical(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod, live_period: Period
):
    on_time = await _create_activity(client, project, live_schedule_period, "On time")
    at_risk = await _create_activity(client, project, live_schedule_period, "At risk")
    delayed = await _create_activity(client, project, live_schedule_period, "Delayed")
    # Delayed and also (incorrectly) tagged critical — variance_days must win the bucket.
    await _set_computed_fields(db, delayed["id"], is_critical=True, variance_days=3)
    await _set_computed_fields(db, at_risk["id"], is_critical=True, variance_days=0)
    await _set_computed_fields(db, on_time["id"], is_critical=False, variance_days=0)

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    buckets = resp.json()["schedule_buckets"]
    assert buckets == {"on_time": 1, "at_risk": 1, "delayed": 1, "total": 3}


async def test_critical_only_restricts_bucket_population(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod, live_period: Period
):
    critical = await _create_activity(client, project, live_schedule_period, "Critical")
    noncritical = await _create_activity(client, project, live_schedule_period, "Non-critical")
    await _set_computed_fields(db, critical["id"], is_critical=True, variance_days=0)
    await _set_computed_fields(db, noncritical["id"], is_critical=False, variance_days=0)

    whole = (await client.get(
        "/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period)
    )).json()["schedule_buckets"]
    critical_only = (await client.get(
        "/api/v1/dashboard/overview",
        params=_overview_params(project, live_period, live_schedule_period, critical_only=True),
    )).json()["schedule_buckets"]

    assert whole["total"] == 2
    assert critical_only["total"] == 1
    assert critical_only["at_risk"] == 1


async def test_subproject_scope_uses_sub_critical_field(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod, live_period: Period
):
    top = await _create_activity(client, project, live_schedule_period, "Programme")
    branch = await _create_activity(client, project, live_schedule_period, "Enabling Works", parent_id=top["id"])
    inside = await _create_activity(client, project, live_schedule_period, "Task A", parent_id=branch["id"])
    outside = await _create_activity(client, project, live_schedule_period, "Task B", parent_id=top["id"])
    # Master-critical is False for everything, but the branch's own scoped
    # pass says "inside" is critical within its own sub-network.
    await _set_computed_fields(db, inside["id"], is_critical=False, sub_is_critical=True, variance_days=0)
    await _set_computed_fields(db, outside["id"], is_critical=False, sub_is_critical=None, variance_days=0)

    subproject_resp = await client.post("/api/v1/schedule-subprojects/", json={
        "project_id": str(project.id), "name": "Enabling Works", "root_wbs_id": branch["id"],
    })
    assert subproject_resp.status_code == 201, subproject_resp.text
    subproject = subproject_resp.json()

    scoped = (await client.get(
        "/api/v1/dashboard/overview",
        params=_overview_params(project, live_period, live_schedule_period, subproject_id=subproject["id"]),
    )).json()["schedule_buckets"]

    # Only "Task A" is in the branch; scoped reading uses sub_is_critical (True) -> at_risk.
    assert scoped == {"on_time": 0, "at_risk": 1, "delayed": 0, "total": 1}


async def test_unknown_subproject_id_returns_404(client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod):
    resp = await client.get(
        "/api/v1/dashboard/overview",
        params=_overview_params(project, live_period, live_schedule_period, subproject_id="00000000-0000-0000-0000-000000000000"),
    )
    assert resp.status_code == 404


async def test_milestones_are_filtered_and_sorted_by_finish(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod, live_period: Period
):
    await _create_activity(client, project, live_schedule_period, "Ordinary task")
    later = await _create_activity(client, project, live_schedule_period, "Practical Completion", activity_type="finish_milestone")
    earlier = await _create_activity(client, project, live_schedule_period, "Start on Site", activity_type="start_milestone")
    await _set_computed_fields(db, later["id"], finish=datetime(2026, 12, 1))
    await _set_computed_fields(db, earlier["id"], finish=datetime(2026, 1, 1))

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    milestones = resp.json()["milestones"]
    assert [m["task_name"] for m in milestones] == ["Start on Site", "Practical Completion"]


async def test_top_risks_ordered_by_rating_desc(client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod):
    await _create_risk(client, project, live_period, "Low rating", probability="0.1", impact="0.1")
    await _create_risk(client, project, live_period, "High rating", probability="0.9", impact="0.9")
    await _create_risk(client, project, live_period, "No assessment yet")

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    top = resp.json()["top_risks"]
    assert [r["title"] for r in top] == ["High rating", "Low rating", "No assessment yet"]


async def test_risk_overview_bands_match_heat_matrix_boundaries(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    # bandOf(v) = floor(v*5), clamped 0-4 (frontend/src/components/HeatMatrix.tsx).
    # severity = probBand + impactBand: <=1 Low, 2-5 Medium, 6-8 High.
    await _create_risk(client, project, live_period, "Low severity", probability="0.05", impact="0.05")  # bands 0+0=0
    await _create_risk(client, project, live_period, "Medium severity", probability="0.5", impact="0.5")  # bands 2+2=4
    high = await _create_risk(client, project, live_period, "High severity", probability="0.9", impact="0.9", cost_most_likely="100000")  # bands 4+4=8
    closed = await _create_risk(client, project, live_period, "Closed high severity", probability="0.9", impact="0.9")
    await client.patch(f"/api/v1/risks/{closed['id']}", json={"status": "closed"})

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    body = resp.json()
    overview = body["risk_overview"]
    assert overview == {"high": 1, "medium": 1, "low": 1, "open": 3, "closed": 1}

    exposure = {b["band"]: b["emv_cost"] for b in body["risk_exposure"]}
    # emv_cost is signed (threats negative — see risk.py's _apply_computed_fields):
    # default risk_type is "threat", so emv_cost = -1 * probability * cost_most_likely
    # = -1 * 0.9 * 100000 = -90000.00.
    assert exposure["High"] == "-90000.00"
    assert exposure["Low"] == "0.00"
