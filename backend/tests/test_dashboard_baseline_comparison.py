from __future__ import annotations

from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cost_element import CostElement
from app.models.period import Period
from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_risk(client: AsyncClient, project: Project, period: Period, title: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "title": title}
    payload.update(overrides)
    resp = await client.post("/api/v1/risks/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_cost_element(client: AsyncClient, project: Project, period: Period, description: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "description": description}
    payload.update(overrides)
    resp = await client.post("/api/v1/cost-elements/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_icd_item(client: AsyncClient, project: Project, period: Period, item_type: str, title: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "item_type": item_type, "title": title}
    payload.update(overrides)
    resp = await client.post("/api/v1/icd-items/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _capture_all(
    client: AsyncClient, project: Project, period: Period, schedule_period: SchedulePeriod,
    name: str = "Set 1", baseline_date: str | None = None,
) -> dict:
    # Defaults to "today" rather than a fixed historical literal (2026-08-30
    # fix — the old hardcoded "2026-07-20" rotted: test_schedule_spi_...
    # sets the activity's own start/finish relative to datetime.now() (a
    # real 20-day span straddling "today," per that test's own comment), so
    # once the suite's simulated "today" moved past mid-2026-07, the fixed
    # baseline_date fell *before* the activity's start entirely —
    # elapsed_duration_fraction correctly returns 0 for a data date before
    # start, giving PV=0 and (correctly, per the pv!=0 guard) SPI=None. Not
    # a bug in the SPI formula itself, just a date literal that only ever
    # worked for however long "today" stayed near the day this was written.
    resp = await client.post("/api/v1/baseline-sets/capture-all", json={
        "project_id": str(project.id), "name": name,
        "baseline_date": baseline_date or datetime.now().date().isoformat(),
        "period_id": str(period.id), "schedule_period_id": str(schedule_period.id),
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_unknown_baseline_set_returns_404(client: AsyncClient):
    resp = await client.get("/api/v1/dashboard/baseline-comparison", params={"baseline_set_id": "00000000-0000-0000-0000-000000000000"})
    assert resp.status_code == 404


async def test_all_four_modules_compare_against_live_data(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    activity = await _create_activity(client, project, live_schedule_period, "Substructure")
    risk = await _create_risk(client, project, live_period, "Weather delay", probability="0.4", impact="0.3", cost_most_likely="50000")
    cost_el = await _create_cost_element(client, project, live_period, "Substructure works", budget="100000", actuals="20000", pct_complete=20)
    issue = await _create_icd_item(client, project, live_period, "issue", "Site access blocked")

    baseline_set = await _capture_all(client, project, live_period, live_schedule_period)

    # Move every module's live state on since the capture.
    activity_row = await db.get(Activity, activity["id"])
    baseline_finish = activity_row.finish
    activity_row.finish = baseline_finish + timedelta(days=5)
    await db.commit()

    await client.patch(f"/api/v1/risks/{risk['id']}", json={"probability": "0.9"})
    await client.patch(f"/api/v1/cost-elements/{cost_el['id']}", json={"actuals": "60000", "pct_complete": 60})
    await client.patch(f"/api/v1/icd-items/{issue['id']}", json={"status": "closed"})

    resp = await client.get("/api/v1/dashboard/baseline-comparison", params={"baseline_set_id": baseline_set["id"]})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Schedule
    assert body["schedule"]["summary"]["total"] == 1
    assert body["schedule"]["summary"]["slipped_count"] == 1
    sched_item = body["schedule"]["items"][0]
    assert sched_item["variance_days"] == 5

    # Risk: rating moved 0.12 -> 0.27, both present -> "increased".
    assert body["risk"]["summary"]["increased_count"] == 1
    assert body["risk"]["summary"]["decreased_count"] == 0
    risk_item = body["risk"]["items"][0]
    assert risk_item["baseline_rating"] == "0.12"
    assert risk_item["current_rating"] == "0.27"

    # Cost: BAC unchanged (100,000), AC moved 20,000 -> 60,000, pct 20 -> 60.
    assert body["cost"]["summary"]["baseline_bac"] == "100000.00"
    assert body["cost"]["summary"]["current_bac"] == "100000.00"
    cost_item = body["cost"]["items"][0]
    assert cost_item["baseline_cpi"] == "1.0000"  # EV 20,000 / AC 20,000
    assert cost_item["current_cpi"] == "1.0000"  # EV 60,000 / AC 60,000

    # ICD: 1 open issue at baseline time, 0 open now (closed since).
    assert body["icd"]["summary"]["issue"]["baseline_open"] == 1
    assert body["icd"]["summary"]["issue"]["current_open"] == 0


async def test_items_added_after_capture_are_shown_with_no_baseline_value(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """Maro: "if an item was removed or added within period then it should
    [be] shown" — an added activity/risk/cost element/ICD item has no
    baseline snapshot at all (it didn't exist yet), so it must still appear
    in the comparison with baseline_x=None, not be silently omitted just
    because there's nothing to diff it against."""
    baseline_set = await _capture_all(client, project, live_period, live_schedule_period)

    new_activity = await _create_activity(client, project, live_schedule_period, "New Package")
    new_risk = await _create_risk(client, project, live_period, "New Risk", probability="0.5", impact="0.5", cost_most_likely="10000")
    new_cost_el = await _create_cost_element(client, project, live_period, "New Cost Line", budget="20000", pct_complete=10)
    new_issue = await _create_icd_item(client, project, live_period, "issue", "New Issue")

    body = (await client.get("/api/v1/dashboard/baseline-comparison", params={"baseline_set_id": baseline_set["id"]})).json()

    sched_item = next(i for i in body["schedule"]["items"] if i["activity_id"] == new_activity["id"])
    assert sched_item["baseline_finish"] is None

    risk_item = next(i for i in body["risk"]["items"] if i["risk_id"] == new_risk["id"])
    assert risk_item["baseline_rating"] is None and risk_item["current_rating"] == "0.25"

    cost_item = next(i for i in body["cost"]["items"] if i["cost_element_id"] == new_cost_el["id"])
    assert cost_item["baseline_budget"] is None and cost_item["current_budget"] == "20000.00"
    # The added element's BAC must roll into the portfolio's current total too.
    assert body["cost"]["summary"]["current_bac"] == "20000.00"

    icd_item = next(i for i in body["icd"]["items"] if i["icd_item_id"] == new_issue["id"])
    assert icd_item["baseline_status"] is None and icd_item["current_status"] == "open"
    # The added issue must count toward the current open total too.
    assert body["icd"]["summary"]["issue"]["baseline_open"] == 0
    assert body["icd"]["summary"]["issue"]["current_open"] == 1


async def test_schedule_spi_uses_baseline_vs_current_schedule_linked_cost_data(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    activity = await _create_activity(client, project, live_schedule_period, "Substructure")
    cost_el = await _create_cost_element(client, project, live_period, "Substructure works", budget="100000", actuals="30000", pct_complete=50)

    # Directly wire up the schedule link (cost_sync.py's own job normally —
    # never accepted as API input) and give the activity a real, controlled
    # 20-day span straddling today, so PV's own elapsed-fraction is a real,
    # safely-nonzero 0.5 rather than 0 or 1.
    activity_row = await db.get(Activity, activity["id"])
    activity_row.start = datetime.now() - timedelta(days=10)
    activity_row.finish = datetime.now() + timedelta(days=10)
    cost_row = await db.get(CostElement, cost_el["id"])
    cost_row.source = "schedule"
    cost_row.linked_activity_id = activity_row.id
    await db.commit()

    baseline_set = await _capture_all(client, project, live_period, live_schedule_period)

    resp = (await client.get("/api/v1/dashboard/baseline-comparison", params={"baseline_set_id": baseline_set["id"]})).json()
    baseline_spi_first = resp["schedule"]["summary"]["baseline_spi"]
    current_spi_first = resp["schedule"]["summary"]["current_spi"]
    assert baseline_spi_first is not None
    assert current_spi_first is not None

    # Progress since the capture — current SPI must move, baseline SPI (a
    # frozen snapshot) must not.
    await client.patch(f"/api/v1/cost-elements/{cost_el['id']}", json={"pct_complete": 80})
    resp2 = (await client.get("/api/v1/dashboard/baseline-comparison", params={"baseline_set_id": baseline_set["id"]})).json()
    assert resp2["schedule"]["summary"]["baseline_spi"] == baseline_spi_first
    assert resp2["schedule"]["summary"]["current_spi"] != current_spi_first


async def test_schedule_comparison_wbs_slicer_scopes_to_the_chosen_branch(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """2026-09-06, per Maro: "i want the wbs slicer here as well" — same
    _subtree_ids scoping the general WBS slicer already uses on Overview,
    so Baseline Comparison's Schedule tab can narrow down to one branch
    the same way. Both an already-snapshotted activity and one added
    since capture (the "no baseline value yet" case) must respect it."""
    branch_a = await _create_activity(client, project, live_schedule_period, "Branch A", activity_type="wbs_summary")
    branch_b = await _create_activity(client, project, live_schedule_period, "Branch B", activity_type="wbs_summary")
    task_a = await _create_activity(client, project, live_schedule_period, "Task A", parent_id=branch_a["id"])
    task_b = await _create_activity(client, project, live_schedule_period, "Task B", parent_id=branch_b["id"])

    baseline_set = await _capture_all(client, project, live_period, live_schedule_period)
    new_task_a = await _create_activity(client, project, live_schedule_period, "New Task A", parent_id=branch_a["id"])
    new_task_b = await _create_activity(client, project, live_schedule_period, "New Task B", parent_id=branch_b["id"])

    resp = await client.get("/api/v1/dashboard/baseline-comparison", params={
        "baseline_set_id": baseline_set["id"], "schedule_wbs_node_activity_id": branch_a["id"],
    })
    assert resp.status_code == 200, resp.text
    ids = {i["activity_id"] for i in resp.json()["schedule"]["items"]}
    # branch_a itself is included too — create_baseline snapshots every
    # activity, WBS summaries included, and it's its own subtree's root.
    assert ids == {branch_a["id"], task_a["id"], new_task_a["id"]}
    assert branch_b["id"] not in ids and task_b["id"] not in ids and new_task_b["id"] not in ids


async def test_schedule_comparison_wbs_slicer_404s_for_unknown_node(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    baseline_set = await _capture_all(client, project, live_period, live_schedule_period)
    resp = await client.get("/api/v1/dashboard/baseline-comparison", params={
        "baseline_set_id": baseline_set["id"], "schedule_wbs_node_activity_id": "00000000-0000-0000-0000-000000000000",
    })
    assert resp.status_code == 404


async def test_schedule_comparison_milestone_only_toggle(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """2026-09-06, per Maro: "a milestone only toggle to avoid seeing all
    activities" — a schedule with dozens of tasks alongside a handful of
    real milestones should be narrowable down to just the milestones."""
    task = await _create_activity(client, project, live_schedule_period, "A Task")
    milestone = await _create_activity(client, project, live_schedule_period, "A Milestone", activity_type="start_milestone")

    baseline_set = await _capture_all(client, project, live_period, live_schedule_period)
    new_task = await _create_activity(client, project, live_schedule_period, "New Task")
    new_milestone = await _create_activity(client, project, live_schedule_period, "New Milestone", activity_type="finish_milestone")

    resp = await client.get("/api/v1/dashboard/baseline-comparison", params={
        "baseline_set_id": baseline_set["id"], "schedule_milestone_only": True,
    })
    assert resp.status_code == 200, resp.text
    ids = {i["activity_id"] for i in resp.json()["schedule"]["items"]}
    assert ids == {milestone["id"], new_milestone["id"]}
    assert task["id"] not in ids and new_task["id"] not in ids


async def test_module_missing_from_the_set_returns_null_not_an_error(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """capture-all always links all four today, but a set that later has one
    module's baseline deleted (or was only ever partially linked, per the
    "module flexibility" design) must still compare the other three — never
    error out just because one module has nothing to show."""
    baseline_set = await _capture_all(client, project, live_period, live_schedule_period)
    risk_baselines = (await client.get("/api/v1/risk-baselines/", params={"period_id": str(live_period.id)})).json()
    await client.delete(f"/api/v1/risk-baselines/{risk_baselines[0]['id']}")

    resp = await client.get("/api/v1/dashboard/baseline-comparison", params={"baseline_set_id": baseline_set["id"]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["risk"] is None
    assert body["cost"] is not None
    assert body["icd"] is not None
    assert body["schedule"] is not None
