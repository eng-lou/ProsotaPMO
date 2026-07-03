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
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=40)
    assert a["start"] == "2025-06-02T08:00:00"
    assert a["finish"] == "2025-06-06T17:00:00"

    resp = await client.post("/api/v1/activities/reschedule", params={
        "period_id": str(live_period.id), "shift_days": 7,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["shift_days"] == 7
    assert data["old_project_finish"] == "2025-06-06T17:00:00"
    assert data["new_project_finish"] == "2025-06-13T17:00:00"  # +7 calendar days

    refreshed = await client.get(f"/api/v1/activities/{a['id']}")
    assert refreshed.json()["start"] == "2025-06-09T08:00:00"  # anchor moved a week later


async def test_reschedule_can_pull_earlier(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    await _create_activity(client, project, live_period, "Excavation", duration_hours=40)

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
        constraint_type="ms", constraint_date="2025-06-20T08:00:00",
    )
    assert a["start"] == "2025-06-20T08:00:00"

    await client.post("/api/v1/activities/reschedule", params={
        "period_id": str(live_period.id), "shift_days": 10,
    })

    refreshed = await client.get(f"/api/v1/activities/{a['id']}")
    # A hard Mandatory Start constraint deliberately doesn't move when the anchor
    # shifts — the whole point of a hard constraint per PMBOK7 Ch.8.
    assert refreshed.json()["start"] == "2025-06-20T08:00:00"


async def test_reschedule_pins_start_of_in_progress_activity(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    """Per Maro's confirmed correction: once an activity has progress
    (% Complete > 0), its Start is a recorded fact, not a forecast — Reschedule
    must not move it. Only Finish stays live, now driven by remaining_duration_hours
    (what's actually left) rather than the original full duration."""
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=80)  # 10 days
    assert a["start"] == "2025-06-02T08:00:00"
    assert a["finish"] == "2025-06-13T17:00:00"  # 10 working days from Monday

    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={"pct_complete": "50"})
    assert resp.status_code == 200
    assert float(resp.json()["remaining_duration_hours"]) == 40.0  # 80h * (1 - 50%)

    await client.post("/api/v1/activities/reschedule", params={
        "period_id": str(live_period.id), "shift_days": 7,
    })

    refreshed = await client.get(f"/api/v1/activities/{a['id']}")
    data = refreshed.json()
    assert data["start"] == "2025-06-02T08:00:00"  # unchanged — already started
    assert data["finish"] == "2025-06-06T17:00:00"  # 5 remaining working days from the same start


async def test_reschedule_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, frozen_period: Period
):
    resp = await client.post("/api/v1/activities/reschedule", params={
        "period_id": str(frozen_period.id), "shift_days": 5,
    })
    assert resp.status_code == 422
