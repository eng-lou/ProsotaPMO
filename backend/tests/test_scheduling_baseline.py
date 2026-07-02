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


async def test_set_baseline_snapshots_current_dates(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    create = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "task_name": "Piling", "duration_days": 5,
    })
    activity = create.json()
    assert activity["bl_start"] is None  # not yet baselined

    resp = await client.post("/api/v1/activities/set-baseline", params={"period_id": str(live_period.id)})
    assert resp.status_code == 200
    baselined = next(a for a in resp.json() if a["id"] == activity["id"])
    assert baselined["bl_start"] == activity["start"]
    assert baselined["bl_finish"] == activity["finish"]
    assert baselined["bl_duration_days"] == 5
    assert baselined["variance_days"] == 0  # finish == bl_finish at the moment of capture


async def test_variance_appears_after_baseline_when_schedule_shifts(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = (await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "task_name": "Excavation", "duration_days": 5,
    })).json()
    b = (await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "task_name": "Piling", "duration_days": 5,
    })).json()

    await client.post("/api/v1/activities/set-baseline", params={"period_id": str(live_period.id)})

    # Linking a->b after baselining pushes b's dates out — the baseline stays put.
    await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })

    resp = await client.get(f"/api/v1/activities/{b['id']}")
    data = resp.json()
    assert data["bl_start"] == b["start"]      # baseline unchanged
    assert data["start"] != b["start"]         # but live dates moved
    assert data["variance_days"] > 0           # so variance now shows the slip


async def test_set_baseline_is_repeatable(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = (await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "task_name": "Excavation", "duration_days": 5,
    })).json()

    first = await client.post("/api/v1/activities/set-baseline", params={"period_id": str(live_period.id)})
    assert first.status_code == 200

    # A deliberate re-baseline (e.g. after an agreed revision) is allowed — unlike
    # Cost Plan's one-shot rev_a_baseline.
    second = await client.post("/api/v1/activities/set-baseline", params={"period_id": str(live_period.id)})
    assert second.status_code == 200
    _ = a


async def test_set_baseline_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, frozen_period: Period
):
    resp = await client.post("/api/v1/activities/set-baseline", params={"period_id": str(frozen_period.id)})
    assert resp.status_code == 422
