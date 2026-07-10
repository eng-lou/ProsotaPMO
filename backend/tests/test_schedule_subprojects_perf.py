from __future__ import annotations

import time
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


async def test_scale_with_many_subprojects_stays_fast(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Programme")

    branches = []
    for bi in range(10):
        branch = await _create_activity(client, project, live_schedule_period, f"Branch {bi}", parent_id=top["id"])
        acts = []
        for ai in range(15):
            a = await _create_activity(
                client, project, live_schedule_period, f"B{bi}-A{ai}", parent_id=branch["id"], duration_hours=8
            )
            acts.append(a)
        for i in range(len(acts) - 1):
            await _link(client, acts[i], acts[i + 1])
        branches.append((branch, acts))

    for branch, _acts in branches:
        resp = await client.post(
            "/api/v1/schedule-subprojects/",
            json={"project_id": str(project.id), "name": branch["task_name"], "root_wbs_id": branch["id"]},
        )
        assert resp.status_code == 201, resp.text

    # ~161 activities, 10 tagged branches. Now time a single unrelated edit —
    # this is the steady-state cost the touched-set skip (§D.2) exists for.
    target = branches[3][1][2]
    start = time.perf_counter()
    resp = await client.patch(f"/api/v1/activities/{target['id']}", json={"commentary": "perf probe"})
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert resp.status_code == 200, resp.text
    print(f"\n[perf] single-branch edit with 10 tagged subprojects present: {elapsed_ms:.1f} ms")
    assert elapsed_ms < 2000  # generous ceiling — flags a real regression, not a tight benchmark
