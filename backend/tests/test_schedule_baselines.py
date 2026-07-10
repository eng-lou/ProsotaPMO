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


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": "Piling", "duration_hours": 40}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_baseline_snapshots_without_assigning(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period)
    assert activity["bl_start"] is None

    resp = await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Contract Baseline", "baseline_date": "2026-01-01",
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
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()

    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")
    assert resp.status_code == 200
    assigned = next(a for a in resp.json() if a["id"] == activity["id"])
    assert assigned["bl_start"] == activity["start"]
    assert assigned["bl_finish"] == activity["finish"]
    assert float(assigned["bl_duration_hours"]) == 40.0
    assert assigned["variance_days"] == 0

    listing = await client.get("/api/v1/schedule-baselines/", params={"schedule_period_id": str(live_schedule_period.id)})
    assert next(b for b in listing.json() if b["id"] == baseline["id"])["is_active"] is True


async def test_variance_appears_after_assign_when_schedule_shifts(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, task_name="Excavation")
    b = await _create_activity(client, project, live_schedule_period, task_name="Piling")

    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
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
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period)

    early = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Original", "baseline_date": "2026-01-01",
    })).json()

    # Duration change shifts the live finish before capturing the second baseline.
    await client.patch(f"/api/v1/activities/{activity['id']}", json={"duration_hours": 80})
    later = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Revision 1", "baseline_date": "2026-02-01",
    })).json()

    await client.post(f"/api/v1/schedule-baselines/{early['id']}/assign")
    after_early = (await client.get(f"/api/v1/activities/{activity['id']}")).json()
    listing = (await client.get("/api/v1/schedule-baselines/", params={"schedule_period_id": str(live_schedule_period.id)})).json()
    assert next(b for b in listing if b["id"] == early["id"])["is_active"] is True
    assert next(b for b in listing if b["id"] == later["id"])["is_active"] is False

    await client.post(f"/api/v1/schedule-baselines/{later['id']}/assign")
    after_later = (await client.get(f"/api/v1/activities/{activity['id']}")).json()
    listing = (await client.get("/api/v1/schedule-baselines/", params={"schedule_period_id": str(live_schedule_period.id)})).json()
    assert next(b for b in listing if b["id"] == early["id"])["is_active"] is False
    assert next(b for b in listing if b["id"] == later["id"])["is_active"] is True

    assert after_early["bl_finish"] != after_later["bl_finish"]


async def test_activity_created_after_baseline_gets_null_bl_fields_on_assign(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()
    assert baseline["activity_count"] == 0

    later_activity = await _create_activity(client, project, live_schedule_period, task_name="Added later")
    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")
    assigned = next(a for a in resp.json() if a["id"] == later_activity["id"])
    assert assigned["bl_start"] is None
    assert assigned["bl_finish"] is None


async def test_list_baselines_ordered_and_scoped_to_period(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    await _create_activity(client, project, live_schedule_period)
    await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Older", "baseline_date": "2026-01-01",
    })
    await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Newer", "baseline_date": "2026-02-01",
    })

    resp = await client.get("/api/v1/schedule-baselines/", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.status_code == 200
    names = [b["name"] for b in resp.json()]
    assert names == ["Newer", "Older"]  # most recent baseline_date first


async def test_delete_baseline(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Mistake", "baseline_date": "2026-01-01",
    })).json()

    resp = await client.delete(f"/api/v1/schedule-baselines/{baseline['id']}")
    assert resp.status_code == 204

    listing = await client.get("/api/v1/schedule-baselines/", params={"schedule_period_id": str(live_schedule_period.id)})
    assert listing.json() == []


async def test_deleting_active_baseline_clears_activity_bl_fields(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """Regression test: deleting the active baseline used to leave every
    activity's bl_start/bl_finish/bl_duration_hours/variance_days holding the
    now-deleted baseline's stale snapshot forever (both the table and the
    Gantt kept showing it) — Maro caught this in the real app. With the
    baseline gone there's no reference point left, so these must clear, the
    same "no snapshot = null" rule assign_baseline already applies to
    activities created after a capture."""
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()
    await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")

    resp = await client.delete(f"/api/v1/schedule-baselines/{baseline['id']}")
    assert resp.status_code == 204

    refreshed = (await client.get(f"/api/v1/activities/{activity['id']}")).json()
    assert refreshed["bl_start"] is None
    assert refreshed["bl_finish"] is None
    assert refreshed["bl_duration_hours"] is None
    assert refreshed["variance_days"] is None


async def test_unassign_baseline_clears_bl_fields_but_keeps_baseline(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """Unassign is the opposite of assign: clears every activity's
    bl_start/bl_finish/bl_duration_hours/variance_days like a delete would,
    but the baseline itself stays in the saved list — assignable again later
    (2026-07-04, per Maro: "I want to be able to unassign after I assign a
    baseline")."""
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()
    await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")

    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/unassign")
    assert resp.status_code == 200
    unassigned = next(a for a in resp.json() if a["id"] == activity["id"])
    assert unassigned["bl_start"] is None
    assert unassigned["bl_finish"] is None
    assert unassigned["bl_duration_hours"] is None
    assert unassigned["variance_days"] is None

    refreshed = (await client.get(f"/api/v1/activities/{activity['id']}")).json()
    assert refreshed["bl_start"] is None

    listing = (await client.get("/api/v1/schedule-baselines/", params={"schedule_period_id": str(live_schedule_period.id)})).json()
    saved = next(b for b in listing if b["id"] == baseline["id"])
    assert saved["is_active"] is False


async def test_unassign_then_reassign_baseline_restores_bl_fields(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()
    await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")
    await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/unassign")

    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")
    reassigned = next(a for a in resp.json() if a["id"] == activity["id"])
    assert reassigned["bl_start"] == activity["start"]
    assert reassigned["bl_finish"] == activity["finish"]


async def test_unassign_rejects_baseline_that_isnt_active(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Never assigned", "baseline_date": "2026-01-01",
    })).json()

    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/unassign")
    assert resp.status_code == 422


async def test_unassign_baseline_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "X", "baseline_date": "2026-01-01",
    })).json()
    await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")

    live_schedule_period.freeze_status = "frozen"
    await db.commit()

    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/unassign")
    assert resp.status_code == 422


async def test_deleting_inactive_baseline_leaves_active_ones_bl_fields_alone(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """Only the currently-*active* baseline's removal should clear anything —
    deleting some other saved-but-not-assigned baseline has no effect on what
    every activity is currently showing."""
    await _anchor(db, live_schedule_period)
    activity = await _create_activity(client, project, live_schedule_period)
    active = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Active One", "baseline_date": "2026-01-01",
    })).json()
    other = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Unused", "baseline_date": "2026-02-01",
    })).json()
    await client.post(f"/api/v1/schedule-baselines/{active['id']}/assign")

    resp = await client.delete(f"/api/v1/schedule-baselines/{other['id']}")
    assert resp.status_code == 204

    refreshed = (await client.get(f"/api/v1/activities/{activity['id']}")).json()
    assert refreshed["bl_start"] is not None
    assert refreshed["bl_finish"] is not None


async def test_create_baseline_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, frozen_schedule_period: SchedulePeriod
):
    resp = await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(frozen_schedule_period.id), "name": "X", "baseline_date": "2026-01-01",
    })
    assert resp.status_code == 422


async def test_assign_baseline_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod, frozen_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "X", "baseline_date": "2026-01-01",
    })).json()

    # Freeze the period the baseline belongs to, then attempt to assign it.
    live_schedule_period.freeze_status = "frozen"
    await db.commit()

    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")
    assert resp.status_code == 422
    _ = frozen_schedule_period


async def test_delete_baseline_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "X", "baseline_date": "2026-01-01",
    })).json()

    live_schedule_period.freeze_status = "frozen"
    await db.commit()

    resp = await client.delete(f"/api/v1/schedule-baselines/{baseline['id']}")
    assert resp.status_code == 422


# --- Promote to schedule (docs/SCHEDULING_GAPS_PLAN.md Phase 6) ---------------

async def test_promote_baseline_creates_independent_variant_with_snapshot_values(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, task_name="Excavation", duration_hours=8)
    b = await _create_activity(client, project, live_schedule_period, task_name="Piling", duration_hours=16)
    await client.post("/api/v1/activity-relationships/", json={"predecessor_id": a["id"], "successor_id": b["id"]})

    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Contract Baseline", "baseline_date": "2026-01-01",
    })).json()

    # Diverge the live schedule after capture — the promoted copy should not
    # reflect this, since it was seeded from the baseline's own snapshot.
    await client.patch(f"/api/v1/activities/{b['id']}", json={"duration_hours": 40})

    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/promote", json={"name": "Baseline as Schedule"})
    assert resp.status_code == 201, resp.text
    promoted = resp.json()
    assert promoted["relationships_from_baseline_snapshot"] is True
    variant = promoted["variant"]
    assert variant["is_master"] is False
    assert variant["name"] == "Baseline as Schedule"

    promoted_period = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": variant["id"]}
    )).json()[0]
    promoted_activities = (await client.get(
        "/api/v1/activities/", params={"project_id": str(project.id), "schedule_period_id": promoted_period["id"]}
    )).json()
    assert len(promoted_activities) == 2
    promoted_a = next(x for x in promoted_activities if x["task_name"] == "Excavation")
    promoted_b = next(x for x in promoted_activities if x["task_name"] == "Piling")
    assert float(promoted_b["duration_hours"]) == 16.0  # baseline's captured value, not the live 40

    rels = (await client.get(
        "/api/v1/activity-relationships/", params={"schedule_period_id": promoted_period["id"]}
    )).json()
    assert len(rels) == 1
    assert rels[0]["predecessor_id"] == promoted_a["id"]
    assert rels[0]["successor_id"] == promoted_b["id"]

    # Editing the promoted copy must never touch the source schedule.
    await client.patch(f"/api/v1/activities/{promoted_a['id']}", json={"task_name": "Renamed In Promoted"})
    original_a = (await client.get(f"/api/v1/activities/{a['id']}")).json()
    assert original_a["task_name"] == "Excavation"


async def test_promote_baseline_without_relationship_snapshot_falls_back_to_live_logic(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """A baseline captured before schedule_baseline_relationships existed has
    no snapshot rows there — simulate that by deleting them post-capture, and
    confirm promote falls back to the current live relationships instead of
    producing a schedule with no logic at all."""
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, task_name="Excavation", duration_hours=8)
    b = await _create_activity(client, project, live_schedule_period, task_name="Piling", duration_hours=16)
    await client.post("/api/v1/activity-relationships/", json={"predecessor_id": a["id"], "successor_id": b["id"]})

    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Old-Style Baseline", "baseline_date": "2026-01-01",
    })).json()

    from sqlalchemy import delete as sa_delete
    from app.models.schedule_baseline import ScheduleBaselineRelationship
    await db.execute(sa_delete(ScheduleBaselineRelationship).where(
        ScheduleBaselineRelationship.baseline_id == baseline["id"]
    ))
    await db.commit()

    resp = await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/promote", json={"name": "Fallback Promotion"})
    assert resp.status_code == 201, resp.text
    promoted = resp.json()
    assert promoted["relationships_from_baseline_snapshot"] is False

    promoted_period = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": promoted["variant"]["id"]}
    )).json()[0]
    rels = (await client.get(
        "/api/v1/activity-relationships/", params={"schedule_period_id": promoted_period["id"]}
    )).json()
    assert len(rels) == 1  # recovered from the current live relationship, not lost


async def test_promote_baseline_not_found(client: AsyncClient, project: Project):
    resp = await client.post(
        f"/api/v1/schedule-baselines/{project.id}/promote", json={"name": "X"}
    )
    assert resp.status_code == 404
