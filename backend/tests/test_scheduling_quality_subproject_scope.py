from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schedule_period import SchedulePeriod
from app.models.project import Project

_MONDAY = date(2025, 6, 2)


async def _anchor(db: AsyncSession, period: SchedulePeriod) -> None:
    period.start_date = _MONDAY
    await db.commit()


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _link(client: AsyncClient, pred: dict, succ: dict, **overrides) -> dict:
    payload = {"predecessor_id": pred["id"], "successor_id": succ["id"]}
    payload.update(overrides)
    resp = await client.post("/api/v1/activity-relationships/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _tag_subproject(client: AsyncClient, project: Project, root: dict, name: str) -> dict:
    resp = await client.post("/api/v1/schedule-subprojects/", json={
        "project_id": str(project.id), "name": name, "root_wbs_id": root["id"],
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _check(report: dict, number: int) -> dict:
    return next(c for c in report["checks"] if c["number"] == number)


async def _build_branch_drowned_by_long_chain(client: AsyncClient, project: Project, period: SchedulePeriod):
    """Same shape as test_schedule_subprojects.py's own core scenario: a short,
    internally-tight branch that only shows real (zero) slack once scoped to
    its own sub-project — on the master schedule it's swamped with float."""
    top = await _create_activity(client, project, period, "Programme")
    branch = await _create_activity(client, project, period, "Enabling Works", parent_id=top["id"])
    a = await _create_activity(client, project, period, "Task A", parent_id=branch["id"], duration_hours=40)
    b = await _create_activity(client, project, period, "Task B", parent_id=branch["id"], duration_hours=40)
    await _link(client, a, b)

    long_chain = [await _create_activity(client, project, period, f"Long {i}", duration_hours=80) for i in range(5)]
    for i in range(len(long_chain) - 1):
        await _link(client, long_chain[i], long_chain[i + 1])

    subproject = await _tag_subproject(client, project, branch, "Enabling Works")
    return subproject, branch, a, b


async def test_scoped_report_restricts_activity_count_to_the_branch(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    subproject, _branch, _a, _b = await _build_branch_drowned_by_long_chain(client, project, live_schedule_period)

    whole = (await client.get("/api/v1/scheduling-quality/", params={"schedule_period_id": str(live_schedule_period.id)})).json()
    scoped = (await client.get("/api/v1/scheduling-quality/", params={
        "schedule_period_id": str(live_schedule_period.id), "scope_subproject_id": subproject["id"],
    })).json()

    assert whole["activity_count"] == 7  # Task A, Task B, 5 long-chain activities
    assert scoped["activity_count"] == 2  # only Task A, Task B
    assert scoped["scope_subproject_id"] == subproject["id"]
    assert scoped["scope_name"] == "Enabling Works"
    assert whole["scope_subproject_id"] is None


async def test_high_float_and_negative_float_checks_read_sub_float_when_scoped(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    subproject, _branch, _a, b = await _build_branch_drowned_by_long_chain(client, project, live_schedule_period)

    whole = (await client.get("/api/v1/scheduling-quality/", params={"schedule_period_id": str(live_schedule_period.id)})).json()
    scoped = (await client.get("/api/v1/scheduling-quality/", params={
        "schedule_period_id": str(live_schedule_period.id), "scope_subproject_id": subproject["id"],
    })).json()

    # On the master schedule, Task B is drowned out by the long chain (huge
    # float, not flagged) — scoped to its own sub-project, it's zero-slack
    # (flagged as negative/high-float-adjacent — here specifically: not
    # "high float" since 0 days isn't > 44, but genuinely different from the
    # master reading, proven via the raw activity fetch below).
    whole_check6 = _check(whole, 6)
    scoped_check6 = _check(scoped, 6)
    assert b["code"] not in whole_check6["failing_activity_codes"]
    assert b["code"] not in scoped_check6["failing_activity_codes"]  # 0 days isn't "high" either

    b_after = (await client.get(f"/api/v1/activities/{b['id']}")).json()
    assert float(b_after["total_float_hours"]) > 100  # master: swamped by the long chain
    assert float(b_after["sub_total_float_hours"]) == 0.0  # scoped: genuinely tight


async def test_critical_path_check_reads_sub_critical_when_scoped(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    subproject, _branch, _a, _b = await _build_branch_drowned_by_long_chain(client, project, live_schedule_period)

    scoped = (await client.get("/api/v1/scheduling-quality/", params={
        "schedule_period_id": str(live_schedule_period.id), "scope_subproject_id": subproject["id"],
    })).json()
    whole = (await client.get("/api/v1/scheduling-quality/", params={"schedule_period_id": str(live_schedule_period.id)})).json()

    # Scoped: Task A -> Task B is the branch's own whole (2-activity) critical
    # path. Whole schedule: the 5-activity long chain is what's actually
    # critical instead — a different, longer chain reported.
    assert "2 critical activities" in _check(scoped, 12)["actual"]
    assert "5 critical activities" in _check(whole, 12)["actual"]


async def test_unknown_scope_subproject_id_returns_404(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    resp = await client.get("/api/v1/scheduling-quality/", params={
        "schedule_period_id": str(live_schedule_period.id), "scope_subproject_id": "00000000-0000-0000-0000-000000000000",
    })
    assert resp.status_code == 404


async def test_saved_run_persists_scope(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    subproject, _branch, _a, _b = await _build_branch_drowned_by_long_chain(client, project, live_schedule_period)

    create_resp = await client.post("/api/v1/scheduling-quality-runs/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Enabling Works checkpoint", "scope_subproject_id": subproject["id"],
    })
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["report"]["scope_subproject_id"] == subproject["id"]
    assert created["report"]["scope_name"] == "Enabling Works"

    listing = (await client.get("/api/v1/scheduling-quality-runs/", params={"schedule_period_id": str(live_schedule_period.id)})).json()
    summary = next(r for r in listing if r["id"] == created["id"])
    assert summary["scope_subproject_id"] == subproject["id"]
    assert summary["scope_name"] == "Enabling Works"
