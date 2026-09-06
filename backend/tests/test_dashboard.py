from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

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


async def _create_resource(client: AsyncClient, project: Project, name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "resource_type": "subcontractor", "name": name, "unit": "lump sum", "rate": "15000.00"}
    payload.update(overrides)
    resp = await client.post("/api/v1/resources/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_resource_assignment(client: AsyncClient, resource: dict, activity: dict, **overrides) -> dict:
    payload = {"resource_id": resource["id"], "activity_id": activity["id"]}
    payload.update(overrides)
    resp = await client.post("/api/v1/resource-assignments/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _make_collection(client: AsyncClient, project: Project, name: str) -> str:
    resp = await client.post("/api/v1/collections/", json={"project_id": str(project.id), "name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_clash_test(client: AsyncClient, project: Project, group_a: str, group_b: str) -> dict:
    resp = await client.post("/api/v1/clash-tests/", json={
        "project_id": str(project.id), "name": "Walls vs Pipes",
        "group_a_collection_id": group_a, "group_b_collection_id": group_b,
        "test_type": "hard", "tolerance_mm": 0.0,
    })
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


async def test_eac_forecast_comparison_formulas(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    await _create_cost_element(client, project, live_period, "Substructure", budget="100000", actuals="40000", pct_complete=50)
    await _create_cost_element(client, project, live_period, "Prelims", element_type="percentage", rate="0.10", pct_complete=50)

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    kpis = resp.json()["kpis"]
    # Same BAC=110,000/AC=44,000/EV=55,000 as the BAC/EAC/CPI rollup test.
    # EAC2 (remaining at plan rate) = AC + (BAC-EV) = 44,000 + 55,000 = 99,000.00.
    assert kpis["eac_remaining_at_plan"] == "99000.00"
    # EAC3 (SPI x CPI composite) needs a real schedule_spi — none of these
    # elements are schedule-linked, so it must stay null, never a fake number.
    assert kpis["eac_composite"] is None
    # EAC4 (bottom-up remaining cost): neither element is schedule-linked, so
    # neither has a real P6 RemainingDuration re-estimate to draw on — falls
    # back to the same "remaining at plan rate" figure as EAC2, per-element.
    assert kpis["eac_bottom_up"] == "99000.00"


async def test_eac_bottom_up_uses_activitys_own_remaining_duration(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """The 4th, non-ratio P6 technique — "ETC = remaining cost for
    activity" — must come from the activity's own Activity.remaining_
    duration_hours (a real P6 RemainingDuration import, or set directly
    here to isolate this from CPM/P6-import specifics), not be silently
    just another view of BAC/EV/CPI/SPI. duration_hours=80 (10 days),
    remaining_duration_hours forced to 24 (3 days) — a fraction (0.3) that
    deliberately does NOT match pct_complete (60%, giving 0.4 remaining
    under "plan rate") or CPI/SPI, so a bug that quietly fell back to one
    of those formulas would be caught by a different expected number."""
    activity = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=80)
    resource = await _create_resource(client, project, "Piling gang", resource_type="labour", unit="day", rate="1000.00")
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })  # BAC = 10 days * 100% * 1000 = 10000

    resp = await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id), "period_id": str(live_period.id)})
    element = next(e for e in resp.json() if e["source"] == "schedule")
    assert float(element["budget"]) == 10000.0

    await client.patch(f"/api/v1/cost-elements/{element['id']}", json={"pct_complete": 60, "actuals": "5000"})
    await _set_computed_fields(db, activity["id"], remaining_duration_hours=Decimal("24"))

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    kpis = resp.json()["kpis"]
    assert kpis["eac_remaining_at_plan"] == "9000.00"    # AC(5000) + (BAC-EV)(10000-6000=4000) — the OTHER formula
    assert kpis["eac_bottom_up"] == "8000.00"            # AC(5000) + BAC(10000) x 24/80 remaining (3000)


async def test_dcma_quality_summary_reflects_live_activity_count(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    await _create_activity(client, project, live_schedule_period, "Task A")
    await _create_activity(client, project, live_schedule_period, "Task B")

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    dcma = resp.json()["dcma_quality"]
    assert dcma["activity_count"] == 2
    assert dcma["scope_name"] is None
    assert dcma["total_checks"] > 0
    assert dcma["passing_count"] + dcma["failing_count"] + dcma["warning_count"] <= dcma["total_checks"]


async def test_clash_summary_counts_by_status(client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod):
    group_a = await _make_collection(client, project, "Walls")
    group_b = await _make_collection(client, project, "Pipes")
    test = await _make_clash_test(client, project, group_a, group_b)
    put_resp = await client.put(f"/api/v1/clash-tests/{test['id']}/results", json=[
        {"element_a_source_kind": "ifc", "element_a_ref": "wall-1", "element_a_label": "wall-1",
         "element_b_source_kind": "ifc", "element_b_ref": "pipe-1", "element_b_label": "pipe-1", "distance_mm": None},
        {"element_a_source_kind": "ifc", "element_a_ref": "wall-2", "element_a_label": "wall-2",
         "element_b_source_kind": "ifc", "element_b_ref": "pipe-2", "element_b_label": "pipe-2", "distance_mm": None},
    ])
    assert put_resp.status_code == 200, put_resp.text
    result_id = put_resp.json()["results"][0]["id"]
    await client.patch(f"/api/v1/clash-results/{result_id}", json={"status": "reviewed"})

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    body = resp.json()
    clash = body["clash_summary"]
    assert clash["test_count"] == 1
    assert clash["total_clashes"] == 2
    assert clash["new_count"] == 1
    assert clash["reviewed_count"] == 1
    assert clash["approved_count"] == 0
    assert len(clash["by_test"]) == 1
    assert clash["by_test"][0]["test_name"] == "Walls vs Pipes"
    assert clash["by_test"][0]["total"] == 2
    assert clash["by_test"][0]["reviewed_count"] == 1

    pairs = {p["element_a_label"]: p for p in body["clash_pairs"]}
    assert len(pairs) == 2
    assert pairs["wall-1"]["element_b_label"] == "pipe-1"
    assert pairs["wall-1"]["status"] == "reviewed"
    assert pairs["wall-1"]["test_name"] == "Walls vs Pipes"
    assert pairs["wall-2"]["status"] == "new"


async def test_project_info_counts_relationships_and_resources(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Task A")
    b = await _create_activity(client, project, live_schedule_period, "Task B")
    rel_resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"], "relationship_type": "FS",
    })
    assert rel_resp.status_code == 201, rel_resp.text
    resource = await _create_resource(client, project, "ACME Piling Ltd")

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    info = resp.json()["project_info"]
    assert info["total_activities"] == 2
    assert info["total_relationships"] == 1
    assert info["total_resources"] == 1
    assert info["has_baseline"] is False


async def test_cost_elements_summary_resolves_percentage_element_computed_fields(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    await _create_cost_element(
        client, project, live_period, "Substructure", element_group="Substructure Works",
        cost_owner="QS A", budget="100000", actuals="40000", pct_complete=50,
    )
    # Percentage element: bac/ac must read the resolved computed_budget/computed_actuals
    # (10,000/4,000), never the raw (null) budget/actuals columns.
    await _create_cost_element(
        client, project, live_period, "Prelims", element_group="Prelims",
        element_type="percentage", rate="0.10", pct_complete=50,
    )

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    elements = {e["description"]: e for e in resp.json()["cost_elements"]}
    assert elements["Substructure"]["bac"] == "100000.00"
    assert elements["Substructure"]["ac"] == "40000.00"
    assert elements["Substructure"]["element_group"] == "Substructure Works"
    assert elements["Substructure"]["cost_owner"] == "QS A"
    assert elements["Prelims"]["bac"] == "10000.00"
    assert elements["Prelims"]["ac"] == "4000.00"


async def test_resource_assignments_summary_carries_denormalized_and_computed_fields(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    activity = await _create_activity(client, project, live_schedule_period, "Piling")
    resource = await _create_resource(
        client, project, "ACME Piling Ltd", discipline="Groundworks", company="ACME Ltd",
    )
    await _create_resource_assignment(client, resource, activity, role="Piling Subcontractor")

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    assignments = resp.json()["resource_assignments"]
    assert len(assignments) == 1
    a = assignments[0]
    assert a["resource_name"] == "ACME Piling Ltd"
    assert a["resource_type"] == "subcontractor"
    assert a["discipline"] == "Groundworks"
    assert a["company"] == "ACME Ltd"
    assert a["role"] == "Piling Subcontractor"
    # Subcontractor budget is a flat lump sum (resource.rate), regardless of
    # the activity's own duration — see resource_costing.compute_assignment_budget.
    assert a["budget"] == "15000.00"
    assert a["activity_task_name"] == "Piling"


async def test_icd_items_summary_covers_issues_changes_and_decisions(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    await _create_icd_item(client, project, live_period, "issue", "Site access blocked", severity="high", owner="Jane")
    await _create_icd_item(
        client, project, live_period, "change", "Extra fire doors",
        ccb_decision="approved", cost_impact="5000",
    )
    await _create_icd_item(
        client, project, live_period, "decision", "Facade material choice",
        decision_maker="Client", required_by="2026-08-01",
    )

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    items = {i["item_type"]: i for i in resp.json()["icd_items"]}
    assert items["issue"]["severity"] == "high"
    assert items["issue"]["owner"] == "Jane"
    assert items["change"]["ccb_decision"] == "approved"
    assert items["change"]["cost_impact"] == "5000.00"
    assert items["decision"]["decision_maker"] == "Client"
    assert items["decision"]["required_by"] == "2026-08-01"


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


async def test_wbs_node_scope_filters_activities_by_subtree(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod, live_period: Period
):
    top = await _create_activity(client, project, live_schedule_period, "Programme")
    branch = await _create_activity(client, project, live_schedule_period, "Enabling Works", parent_id=top["id"])
    inside = await _create_activity(client, project, live_schedule_period, "Task A", parent_id=branch["id"])
    outside = await _create_activity(client, project, live_schedule_period, "Task B", parent_id=top["id"])
    # 2026-08-28: the WBS slicer always reads the master is_critical field —
    # unlike the old registered-sub-project picker it replaced, there's no
    # separate sub_is_critical for an arbitrary node chosen ad hoc.
    await _set_computed_fields(db, inside["id"], is_critical=True, variance_days=0)
    await _set_computed_fields(db, outside["id"], is_critical=False, variance_days=0)

    scoped = (await client.get(
        "/api/v1/dashboard/overview",
        params=_overview_params(project, live_period, live_schedule_period, wbs_node_activity_id=branch["id"]),
    )).json()["schedule_buckets"]

    # Only "Task A" is in the branch's own subtree.
    assert scoped == {"on_time": 0, "at_risk": 1, "delayed": 0, "total": 1}


async def test_unknown_wbs_node_activity_id_returns_404(client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod):
    resp = await client.get(
        "/api/v1/dashboard/overview",
        params=_overview_params(project, live_period, live_schedule_period, wbs_node_activity_id="00000000-0000-0000-0000-000000000000"),
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


async def test_schedule_activities_excludes_milestones_and_wbs_summaries(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod, live_period: Period
):
    top = await _create_activity(client, project, live_schedule_period, "Programme")
    task = await _create_activity(client, project, live_schedule_period, "Ordinary task", parent_id=top["id"])
    await _create_activity(client, project, live_schedule_period, "Practical Completion", activity_type="finish_milestone", parent_id=top["id"])
    await _set_computed_fields(
        db, task["id"], is_critical=True, variance_days=2, total_float_hours=Decimal("0.00"), pct_complete=Decimal("40.00"),
    )

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    activities = resp.json()["schedule_activities"]
    # "Programme" auto-becomes a wbs_summary (it gained children) and is excluded;
    # the milestone is excluded too (that's milestones' own field to cover).
    assert [a["task_name"] for a in activities] == ["Ordinary task"]
    assert activities[0]["is_critical"] is True
    assert activities[0]["variance_days"] == 2
    assert activities[0]["total_float_hours"] == "0.00"
    assert activities[0]["pct_complete"] == "40.00"


async def test_lookahead_flags_incomplete_predecessor_and_respects_window(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod, live_period: Period
):
    predecessor = await _create_activity(client, project, live_schedule_period, "Predecessor")
    in_window = await _create_activity(client, project, live_schedule_period, "In window")
    out_of_window = await _create_activity(client, project, live_schedule_period, "Out of window")

    rel_resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": predecessor["id"], "successor_id": in_window["id"], "relationship_type": "FS",
    })
    assert rel_resp.status_code == 201, rel_resp.text

    # Set AFTER every schedule-mutating API call — creating a relationship
    # triggers a real CPM recompute (scheduling_cpm.py) that would otherwise
    # overwrite these server-computed fields right back to whatever the
    # (duration-less, in this test) network actually resolves to.
    now = datetime.now()
    await _set_computed_fields(db, predecessor["id"], pct_complete=Decimal("50.00"))
    await _set_computed_fields(db, in_window["id"], start=now + timedelta(weeks=2), pct_complete=Decimal("0.00"))
    await _set_computed_fields(db, out_of_window["id"], start=now + timedelta(weeks=10), pct_complete=Decimal("0.00"))

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    body = resp.json()
    items = {i["task_name"]: i for i in body["lookahead_items"]}
    # "Predecessor" is link-driven, real CPM behaviour, not a bug (2026-08-30
    # fix, per Maro — an earlier version of this test wrongly assumed a
    # never-explicitly-dated activity stays start=None): with no duration/
    # start of its own and no predecessor to wait on, CPM schedules it ASAP
    # — start = now (rolled to the next working day-start) — which
    # genuinely falls inside the 6-week window, so it correctly belongs in
    # the Look-Ahead alongside "In window". The 10-week-out activity is
    # still correctly excluded.
    assert set(items.keys()) == {"Predecessor", "In window"}
    assert items["In window"]["has_incomplete_predecessor"] is True
    # Predecessor has no predecessor of its own, so it isn't flagged either.
    assert items["Predecessor"]["has_incomplete_predecessor"] is False

    summary = body["lookahead_summary"]
    assert summary["window_weeks"] == 6
    assert summary["total_in_window"] == 2
    assert summary["incomplete_predecessor_count"] == 1


async def test_mitigation_actions_summary_carries_owner_and_status(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    risk = await _create_risk(client, project, live_period, "Vendor delay risk")
    action_resp = await client.post("/api/v1/risk-mitigation-actions/", json={
        "risk_id": risk["id"], "description": "Dual-source supplier", "owner": "Jane Smith",
        "status": "in_progress", "pct_complete": 40,
    })
    assert action_resp.status_code == 201, action_resp.text

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    actions = resp.json()["mitigation_actions"]
    assert len(actions) == 1
    assert actions[0]["risk_code"] == risk["code"]
    assert actions[0]["description"] == "Dual-source supplier"
    assert actions[0]["owner"] == "Jane Smith"
    assert actions[0]["status"] == "in_progress"
    assert actions[0]["pct_complete"] == 40


async def test_top_risks_ordered_by_rating_desc(client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod):
    await _create_risk(client, project, live_period, "Low rating", probability="0.1", impact="0.1")
    await _create_risk(client, project, live_period, "High rating", probability="0.9", impact="0.9")
    await _create_risk(client, project, live_period, "No assessment yet")

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    top = resp.json()["top_risks"]
    assert [r["title"] for r in top] == ["High rating", "Low rating", "No assessment yet"]


async def test_risks_summary_carries_raw_fields_for_widgets(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    await _create_risk(
        client, project, live_period, "Vendor delay risk",
        category="Schedule", area="Vendor", risk_owner="Jane Smith",
        risk_type="threat", response_strategy="mitigate",
    )

    resp = await client.get("/api/v1/dashboard/overview", params=_overview_params(project, live_period, live_schedule_period))
    risks = resp.json()["risks"]
    assert len(risks) == 1
    assert risks[0]["category"] == "Schedule"
    assert risks[0]["area"] == "Vendor"
    assert risks[0]["risk_owner"] == "Jane Smith"
    assert risks[0]["risk_type"] == "threat"
    assert risks[0]["response_strategy"] == "mitigate"


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
