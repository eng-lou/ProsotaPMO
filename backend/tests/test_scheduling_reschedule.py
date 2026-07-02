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


async def test_reschedule_shifts_unconstrained_activities(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_days=5)
    assert a["start"] == "2025-06-02"
    assert a["finish"] == "2025-06-06"

    resp = await client.post("/api/v1/activities/reschedule", params={
        "period_id": str(live_period.id), "shift_days": 7,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["shift_days"] == 7
    assert data["old_project_finish"] == "2025-06-06"
    assert data["new_project_finish"] == "2025-06-13"  # +7 calendar days

    refreshed = await client.get(f"/api/v1/activities/{a['id']}")
    assert refreshed.json()["start"] == "2025-06-09"  # anchor moved a week later


async def test_reschedule_can_pull_earlier(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    await _create_activity(client, project, live_period, "Excavation", duration_days=5)

    resp = await client.post("/api/v1/activities/reschedule", params={
        "period_id": str(live_period.id), "shift_days": -2,
    })
    assert resp.status_code == 200
    assert resp.json()["new_anchor_date"] == "2025-05-31"


async def test_reschedule_respects_hard_constraint(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(
        client, project, live_period, "Design freeze", activity_type="milestone",
        constraint_type="ms", constraint_date="2025-06-20",
    )
    assert a["start"] == "2025-06-20"

    await client.post("/api/v1/activities/reschedule", params={
        "period_id": str(live_period.id), "shift_days": 10,
    })

    refreshed = await client.get(f"/api/v1/activities/{a['id']}")
    # A hard Mandatory Start constraint deliberately doesn't move when the anchor
    # shifts — the whole point of a hard constraint per PMBOK7 Ch.8.
    assert refreshed.json()["start"] == "2025-06-20"


async def test_reschedule_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, frozen_period: Period
):
    resp = await client.post("/api/v1/activities/reschedule", params={
        "period_id": str(frozen_period.id), "shift_days": 5,
    })
    assert resp.status_code == 422
