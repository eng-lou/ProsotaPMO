from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.models.project import Project

_MONDAY = date(2025, 6, 2)


async def _anchor(db: AsyncSession, period: Period) -> None:
    period.start_date = _MONDAY
    await db.commit()


async def _create_activity(client: AsyncClient, project: Project, period: Period, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _check(report: dict, number: int) -> dict:
    return next(c for c in report["checks"] if c["number"] == number)


async def test_quality_report_empty_period(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.get("/api/v1/scheduling-quality/", params={"period_id": str(live_period.id)})
    assert resp.status_code == 200
    data = resp.json()
    assert data["activity_count"] == 0
    assert len(data["checks"]) == 12


async def test_fully_linked_chain_passes_logic_checks(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "A", duration_hours=40)
    b = await _create_activity(client, project, live_period, "B", duration_hours=40)
    await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })

    resp = await client.get("/api/v1/scheduling-quality/", params={"period_id": str(live_period.id)})
    data = resp.json()
    # a is missing a predecessor, b is missing a successor — both expected/legitimate
    # network endpoints, but the check counts them raw (documented simplification).
    assert _check(data, 1)["actual"] == 50.0
    assert _check(data, 2)["actual"] == 50.0
    assert _check(data, 3)["actual"] == 0.0  # the one relationship is FS
    assert data["logic_score"] == 50.0


async def test_hard_constraint_detected(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    await _create_activity(client, project, live_period, "A", duration_hours=40)
    await _create_activity(
        client, project, live_period, "B", duration_hours=40,
        constraint_type="ms", constraint_date="2025-06-02",
    )

    resp = await client.get("/api/v1/scheduling-quality/", params={"period_id": str(live_period.id)})
    data = resp.json()
    assert _check(data, 8)["actual"] == 50.0
    assert _check(data, 8)["status"] == "fail"  # 50% vs <5% threshold, well past the 2x warn band


async def test_high_duration_flagged(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    await _create_activity(client, project, live_period, "Long haul", duration_hours=400)

    resp = await client.get("/api/v1/scheduling-quality/", params={"period_id": str(live_period.id)})
    data = resp.json()
    assert _check(data, 9)["actual"] == 100.0
    assert _check(data, 9)["status"] == "fail"


async def test_negative_float_detected(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=40)
    milestone = await _create_activity(
        client, project, live_period, "Design freeze", activity_type="milestone",
        constraint_type="fnlt", constraint_date="2025-06-06",
    )
    await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": milestone["id"],
    })

    resp = await client.get("/api/v1/scheduling-quality/", params={"period_id": str(live_period.id)})
    data = resp.json()
    # The infeasible deadline propagates backward through the whole chain — both the
    # predecessor and the milestone end up with negative float, not just the milestone.
    assert _check(data, 7)["actual"] == 100.0
    assert _check(data, 7)["status"] == "fail"  # 0% threshold, any violation fails outright


async def test_critical_path_test_passes_for_single_chain(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "A", duration_hours=40)
    b = await _create_activity(client, project, live_period, "B", duration_hours=40)
    await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })

    resp = await client.get("/api/v1/scheduling-quality/", params={"period_id": str(live_period.id)})
    data = resp.json()
    assert _check(data, 12)["status"] == "pass"


async def test_missed_task_detected(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=40)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()
    await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")

    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={"actual_finish": "2025-06-20"})
    assert resp.status_code == 200

    resp = await client.get("/api/v1/scheduling-quality/", params={"period_id": str(live_period.id)})
    data = resp.json()
    assert _check(data, 11)["actual"] == 100.0
    assert _check(data, 11)["status"] == "fail"
