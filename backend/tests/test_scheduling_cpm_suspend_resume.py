from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod

# Same Monday anchor and standard calendar (Mon-Fri 08:00-17:00, 12:00-13:00
# lunch, net 8h/day) as test_scheduling_cpm.py.
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


async def _get(client: AsyncClient, activity_id: str) -> dict:
    resp = await client.get(f"/api/v1/activities/{activity_id}")
    assert resp.status_code == 200
    return resp.json()


async def test_suspend_resume_pushes_finish_out_by_the_full_gap(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    # No suspend: 40h / 8h-per-day = 5 working days, Mon 02 -> Fri 06 June 17:00
    # (matches test_scheduling_cpm.py::test_isolated_activity_starts_on_anchor).
    assert a["finish"] == "2025-06-06T17:00:00"

    # Suspend after 2 working days (Mon+Tue consumed, 24h/3 days remaining),
    # resume exactly one calendar week later — swallows Wed-Fri and the
    # following Mon-Tue entirely (5 working days of otherwise-available time).
    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={
        "suspend_date": "2025-06-04T08:00:00", "resume_date": "2025-06-11T08:00:00",
    })
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    # The 3 remaining working days now run Wed 11 -> Fri 13 June instead of
    # Wed 04 -> Fri 06 — pushed out by exactly the swallowed working week.
    assert updated["finish"] == "2025-06-13T17:00:00"
    assert updated["suspend_date"] is not None
    assert updated["resume_date"] is not None


async def test_clearing_suspend_resume_reverts_to_the_unsuspended_finish(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    await client.patch(f"/api/v1/activities/{a['id']}", json={
        "suspend_date": "2025-06-04T08:00:00", "resume_date": "2025-06-11T08:00:00",
    })

    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={"suspend_date": None, "resume_date": None})
    assert resp.status_code == 200, resp.text
    assert resp.json()["finish"] == "2025-06-06T17:00:00"


async def test_suspended_predecessor_pushes_fs_successor_start(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    b = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=40)
    await _link(client, a, b)

    await client.patch(f"/api/v1/activities/{a['id']}", json={
        "suspend_date": "2025-06-04T08:00:00", "resume_date": "2025-06-11T08:00:00",
    })

    a = await _get(client, a["id"])
    assert a["finish"] == "2025-06-13T17:00:00"
    b = await _get(client, b["id"])
    # Successor's FS start rolls off the predecessor's new, later finish —
    # same zero-lag snap-forward as the unsuspended case, just later.
    assert b["start"] == "2025-06-16T08:00:00"


async def test_resume_before_suspend_rejected_by_cpm_update(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={
        "suspend_date": "2025-06-11T08:00:00", "resume_date": "2025-06-04T08:00:00",
    })
    assert resp.status_code == 422
