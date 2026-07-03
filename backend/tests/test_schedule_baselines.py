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


async def _create_activity(client: AsyncClient, project: Project, period: Period, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "task_name": "Piling", "duration_hours": 40}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_baseline_snapshots_without_assigning(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    activity = await _create_activity(client, project, live_period)
    assert activity["bl_start"] is None

    resp = await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Contract Baseline", "baseline_date": "2026-01-01",
    })
    assert resp.status_code == 201, resp.text
    baseline = resp.json()
    assert baseline["name"] == "Contract Baseline"
    assert baseline["baseline_date"] == "2026-01-01"
    assert baseline["activity_count"] == 1

    # Capturing a baseline doesn't apply it — bl_start stays null until assigned.
    refreshed = await client.get(f"/api/v1/activities/{activity['id']}")
    assert refreshed.json()["bl_start"] is None


async def test_assign_baseline_copies_snapshot_into_activity(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    activity = await _create_activity(client, project, live_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()

    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")
    assert resp.status_code == 200
    assigned = next(a for a in resp.json() if a["id"] == activity["id"])
    assert assigned["bl_start"] == activity["start"]
    assert assigned["bl_finish"] == activity["finish"]
    assert float(assigned["bl_duration_hours"]) == 40.0
    assert assigned["variance_days"] == 0

    listing = await client.get("/api/v1/schedule-baselines/", params={"period_id": str(live_period.id)})
    assert next(b for b in listing.json() if b["id"] == baseline["id"])["is_active"] is True


async def test_variance_appears_after_assign_when_schedule_shifts(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, task_name="Excavation")
    b = await _create_activity(client, project, live_period, task_name="Piling")

    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()
    await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")

    # Linking a->b after assigning pushes b's dates out — the baseline stays put.
    await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })

    resp = await client.get(f"/api/v1/activities/{b['id']}")
    data = resp.json()
    assert data["bl_start"] == b["start"]      # baseline unchanged
    assert data["start"] != b["start"]         # live dates moved
    assert data["variance_days"] > 0           # variance now shows the slip


async def test_switching_between_two_saved_baselines(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    activity = await _create_activity(client, project, live_period)

    early = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Original", "baseline_date": "2026-01-01",
    })).json()

    # Duration change shifts the live finish before capturing the second baseline.
    await client.patch(f"/api/v1/activities/{activity['id']}", json={"duration_hours": 80})
    later = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Revision 1", "baseline_date": "2026-02-01",
    })).json()

    await client.post(f"/api/v1/schedule-baselines/{early['id']}/assign")
    after_early = (await client.get(f"/api/v1/activities/{activity['id']}")).json()
    listing = (await client.get("/api/v1/schedule-baselines/", params={"period_id": str(live_period.id)})).json()
    assert next(b for b in listing if b["id"] == early["id"])["is_active"] is True
    assert next(b for b in listing if b["id"] == later["id"])["is_active"] is False

    await client.post(f"/api/v1/schedule-baselines/{later['id']}/assign")
    after_later = (await client.get(f"/api/v1/activities/{activity['id']}")).json()
    listing = (await client.get("/api/v1/schedule-baselines/", params={"period_id": str(live_period.id)})).json()
    assert next(b for b in listing if b["id"] == early["id"])["is_active"] is False
    assert next(b for b in listing if b["id"] == later["id"])["is_active"] is True

    assert after_early["bl_finish"] != after_later["bl_finish"]


async def test_activity_created_after_baseline_gets_null_bl_fields_on_assign(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()
    assert baseline["activity_count"] == 0

    later_activity = await _create_activity(client, project, live_period, task_name="Added later")
    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")
    assigned = next(a for a in resp.json() if a["id"] == later_activity["id"])
    assert assigned["bl_start"] is None
    assert assigned["bl_finish"] is None


async def test_list_baselines_ordered_and_scoped_to_period(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    await _create_activity(client, project, live_period)
    await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Older", "baseline_date": "2026-01-01",
    })
    await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Newer", "baseline_date": "2026-02-01",
    })

    resp = await client.get("/api/v1/schedule-baselines/", params={"period_id": str(live_period.id)})
    assert resp.status_code == 200
    names = [b["name"] for b in resp.json()]
    assert names == ["Newer", "Older"]  # most recent baseline_date first


async def test_delete_baseline(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Mistake", "baseline_date": "2026-01-01",
    })).json()

    resp = await client.delete(f"/api/v1/schedule-baselines/{baseline['id']}")
    assert resp.status_code == 204

    listing = await client.get("/api/v1/schedule-baselines/", params={"period_id": str(live_period.id)})
    assert listing.json() == []


async def test_deleting_assigned_baseline_does_not_clear_activity_bl_fields(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    activity = await _create_activity(client, project, live_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()
    await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")

    resp = await client.delete(f"/api/v1/schedule-baselines/{baseline['id']}")
    assert resp.status_code == 204

    # The already-copied bl_start/bl_finish on the activity are untouched —
    # is_active lived on the now-deleted baseline row, not a cross-table
    # pointer that needs separate cleanup.
    refreshed = await client.get(f"/api/v1/activities/{activity['id']}")
    assert refreshed.json()["bl_start"] is not None


async def test_create_baseline_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, frozen_period: Period
):
    resp = await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(frozen_period.id), "name": "X", "baseline_date": "2026-01-01",
    })
    assert resp.status_code == 422


async def test_assign_baseline_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, frozen_period: Period
):
    await _anchor(db, live_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "X", "baseline_date": "2026-01-01",
    })).json()

    # Freeze the period the baseline belongs to, then attempt to assign it.
    live_period.freeze_status = "frozen"
    await db.commit()

    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")
    assert resp.status_code == 422
    _ = frozen_period


async def test_delete_baseline_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "X", "baseline_date": "2026-01-01",
    })).json()

    live_period.freeze_status = "frozen"
    await db.commit()

    resp = await client.delete(f"/api/v1/schedule-baselines/{baseline['id']}")
    assert resp.status_code == 422
