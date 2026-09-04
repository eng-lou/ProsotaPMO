from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cost_element import CostElement
from app.models.period import Period
from app.models.project import Project
from app.models.schedule_period import SchedulePeriod
from tests.test_dashboard_baseline_comparison import _capture_all, _create_activity, _create_cost_element


async def test_pv_ev_ac_trend_point_per_baseline_set_plus_current(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """GET /dashboard/pv-ev-ac-trend (2026-09-04, per Maro — the classic
    PMBOK Figure 4 S-curve, sampled at baseline captures instead of
    continuous calendar time). Same schedule-linked-element wiring as
    test_schedule_spi_uses_baseline_vs_current_schedule_linked_cost_data —
    a real 20-day activity span straddling today gives PV a safely-nonzero
    ~0.5 elapsed fraction."""
    activity = await _create_activity(client, project, live_schedule_period, "Substructure")
    cost_el = await _create_cost_element(
        client, project, live_period, "Substructure works", budget="100000", actuals="30000", pct_complete=50,
    )
    activity_row = await db.get(Activity, activity["id"])
    activity_row.start = datetime.now() - timedelta(days=10)
    activity_row.finish = datetime.now() + timedelta(days=10)
    cost_row = await db.get(CostElement, cost_el["id"])
    cost_row.source = "schedule"
    cost_row.linked_activity_id = activity_row.id
    await db.commit()

    baseline_set = await _capture_all(client, project, live_period, live_schedule_period)

    resp = await client.get("/api/v1/dashboard/pv-ev-ac-trend", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    points = resp.json()["points"]
    assert len(points) == 2  # the captured baseline set + a live Current point

    baseline_point = next(p for p in points if p["baseline_set_id"] == baseline_set["id"])
    assert baseline_point["baseline_name"] == "Set 1"
    # EV = BAC x %complete = 100000 x 50% (exact); AC = actuals (exact) — no
    # elapsed-fraction rounding involved in either, unlike PV.
    assert Decimal(baseline_point["ev"]) == Decimal("50000.00")
    assert Decimal(baseline_point["ac"]) == Decimal("30000.00")
    assert baseline_point["pv"] is not None
    assert Decimal(baseline_point["pv"]) > Decimal(0)

    current_point = next(p for p in points if p["baseline_set_id"] is None)
    assert current_point["baseline_name"] == "Current"
    assert Decimal(current_point["ev"]) == Decimal("50000.00")

    # Progress since the capture — Current must move, the baseline snapshot
    # (frozen) must not. Same discipline as the sibling SPI test.
    await client.patch(f"/api/v1/cost-elements/{cost_el['id']}", json={"pct_complete": 80})
    resp2 = await client.get("/api/v1/dashboard/pv-ev-ac-trend", params={"project_id": str(project.id)})
    points2 = resp2.json()["points"]
    baseline_point2 = next(p for p in points2 if p["baseline_set_id"] == baseline_set["id"])
    current_point2 = next(p for p in points2 if p["baseline_set_id"] is None)
    assert Decimal(baseline_point2["ev"]) == Decimal("50000.00")
    assert Decimal(current_point2["ev"]) == Decimal("80000.00")


async def test_pv_ev_ac_trend_empty_project_returns_no_points(client: AsyncClient, project: Project):
    resp = await client.get("/api/v1/dashboard/pv-ev-ac-trend", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    assert resp.json()["points"] == []
