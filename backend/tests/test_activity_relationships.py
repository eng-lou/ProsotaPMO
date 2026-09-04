from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.schedule_period import SchedulePeriod
from app.models.project import Project


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str) -> dict:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "schedule_period_id": str(period.id),
        "task_name": task_name,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_relationship(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    b = await _create_activity(client, project, live_schedule_period, "Piling")

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"],
        "successor_id": b["id"],
        "relationship_type": "FS",
        "lag_hours": 2,
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["relationship_type"] == "FS"
    assert float(data["lag_hours"]) == 2.0


async def test_relationship_defaults_to_fs_zero_lag(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    b = await _create_activity(client, project, live_schedule_period, "Piling")

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["relationship_type"] == "FS"
    assert float(data["lag_hours"]) == 0.0


async def test_self_relationship_rejected(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": a["id"],
    })
    assert resp.status_code == 422


async def test_exact_duplicate_rejected(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    b = await _create_activity(client, project, live_schedule_period, "Piling")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    assert resp.status_code == 201

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    assert resp.status_code == 422


async def test_different_type_between_same_pair_allowed(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    # Real P6 data can legitimately constrain the same activity pair two
    # ways at once (2026-09-04, found re-verifying EC00610.xml: a genuine
    # Start-to-Start lag AND a separate Finish-to-Start lag between the same
    # two activities) — only an exact same-type duplicate should be
    # rejected, not any second link to an already-linked pair.
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    b = await _create_activity(client, project, live_schedule_period, "Piling")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"], "relationship_type": "SS",
    })
    assert resp.status_code == 201, resp.text

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"], "relationship_type": "FS",
    })
    assert resp.status_code == 201, resp.text

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"], "relationship_type": "SS",
    })
    assert resp.status_code == 422


async def test_reverse_relationship_rejected(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    b = await _create_activity(client, project, live_schedule_period, "Piling")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    assert resp.status_code == 201

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": b["id"], "successor_id": a["id"],
    })
    assert resp.status_code == 422
    assert "reverse" in resp.json()["detail"].lower()


async def test_cross_period_relationship_rejected(
    client: AsyncClient, db: AsyncSession, project: Project, schedule_variant,
    live_schedule_period: SchedulePeriod,
):
    # Only one "live" schedule period is allowed per variant (uq_schedule_periods_variant_live),
    # so the second period here is a non-live one instead, with its activity inserted
    # directly rather than through the API (which would reject a write to a non-live
    # period) — same pattern used elsewhere in this suite for seeding data into a
    # frozen period.
    other_period = SchedulePeriod(
        schedule_variant_id=schedule_variant.id, period_label="Period 2", freeze_status="frozen"
    )
    db.add(other_period)
    await db.commit()
    await db.refresh(other_period)

    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    b_orm = Activity(
        project_id=project.id, schedule_variant_id=schedule_variant.id, schedule_period_id=other_period.id,
        task_name="Piling", code="ACT-9101",
    )
    db.add(b_orm)
    await db.commit()
    await db.refresh(b_orm)

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": str(b_orm.id),
    })
    assert resp.status_code == 422
    assert "same schedule period" in resp.json()["detail"].lower()


async def test_list_relationships_by_period(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    b = await _create_activity(client, project, live_schedule_period, "Piling")
    c = await _create_activity(client, project, live_schedule_period, "Pile caps")
    await client.post("/api/v1/activity-relationships/", json={"predecessor_id": a["id"], "successor_id": b["id"]})
    await client.post("/api/v1/activity-relationships/", json={"predecessor_id": b["id"], "successor_id": c["id"]})

    resp = await client.get("/api/v1/activity-relationships/", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_update_relationship_type_and_lag(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    b = await _create_activity(client, project, live_schedule_period, "Piling")
    create = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    rel_id = create.json()["id"]

    resp = await client.patch(f"/api/v1/activity-relationships/{rel_id}", json={
        "relationship_type": "SS", "lag_hours": -3,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["relationship_type"] == "SS"
    assert float(data["lag_hours"]) == -3.0


async def test_delete_relationship(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    b = await _create_activity(client, project, live_schedule_period, "Piling")
    create = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    rel_id = create.json()["id"]

    resp = await client.delete(f"/api/v1/activity-relationships/{rel_id}")
    assert resp.status_code == 204

    resp = await client.get("/api/v1/activity-relationships/", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.json() == []


async def test_delete_activity_cascades_relationships(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    b = await _create_activity(client, project, live_schedule_period, "Piling")
    await client.post("/api/v1/activity-relationships/", json={"predecessor_id": a["id"], "successor_id": b["id"]})

    resp = await client.delete(f"/api/v1/activities/{a['id']}")
    assert resp.status_code == 200

    resp = await client.get("/api/v1/activity-relationships/", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.json() == []


# --- Constraints -------------------------------------------------------------

async def test_constraint_requires_date_except_asap(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id), "task_name": "Piling",
        "constraint_type": "ms",
    })
    assert resp.status_code == 422


async def test_constraint_date_rejected_without_type(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id), "task_name": "Piling",
        "constraint_date": "2025-06-01",
    })
    assert resp.status_code == 422


async def test_constraint_with_matching_date_accepted(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id), "task_name": "Piling",
        "constraint_type": "fnlt", "constraint_date": "2025-06-01",
    })
    assert resp.status_code == 201
    assert resp.json()["constraint_type"] == "fnlt"


async def test_update_constraint_inconsistent_state_rejected(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    create = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id), "task_name": "Piling",
    })
    activity_id = create.json()["id"]

    resp = await client.patch(f"/api/v1/activities/{activity_id}", json={"constraint_type": "ms"})
    assert resp.status_code == 422


async def _create_milestone(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, activity_type: str) -> dict:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(period.id),
        "task_name": task_name, "activity_type": activity_type,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


# A milestone has zero duration, so ES always equals EF — the relationship
# type's *second* letter (nominally "which successor end") is mathematically
# inert for it; only the *first* letter (which predecessor end) changes the
# result (2026-07-07, per Maro — docs/SCHEDULING_GAPS_PLAN.md Phase 5). A
# Start Milestone is only meaningfully driven by the predecessor's own Start
# (SS/SF); a Finish Milestone only by the predecessor's Finish (FS/FF) —
# conveniently keeping FS, by far the most common type, valid for the far
# more common "milestone marks that this activity is now done" case.
async def test_finish_milestone_accepts_fs(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Design freeze", "finish_milestone")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "FS",
    })
    assert resp.status_code == 201, resp.text


async def test_finish_milestone_accepts_ff(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Design freeze", "finish_milestone")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "FF",
    })
    assert resp.status_code == 201, resp.text


async def test_finish_milestone_rejects_ss(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Design freeze", "finish_milestone")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "SS",
    })
    assert resp.status_code == 422
    assert "Finish Milestone" in resp.json()["detail"]


async def test_finish_milestone_rejects_sf(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Design freeze", "finish_milestone")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "SF",
    })
    assert resp.status_code == 422


async def test_start_milestone_accepts_ss(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Mobilisation started", "start_milestone")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "SS",
    })
    assert resp.status_code == 201, resp.text


async def test_start_milestone_accepts_sf(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Mobilisation started", "start_milestone")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "SF",
    })
    assert resp.status_code == 201, resp.text


async def test_start_milestone_rejects_fs(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Mobilisation started", "start_milestone")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "FS",
    })
    assert resp.status_code == 422
    assert "Start Milestone" in resp.json()["detail"]


async def test_start_milestone_rejects_ff(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Mobilisation started", "start_milestone")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "FF",
    })
    assert resp.status_code == 422


async def test_update_relationship_type_rejects_invalid_milestone_pairing(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Design freeze", "finish_milestone")
    create = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "FS",
    })
    rel_id = create.json()["id"]

    resp = await client.patch(f"/api/v1/activity-relationships/{rel_id}", json={"relationship_type": "SS"})
    assert resp.status_code == 422
    assert "Finish Milestone" in resp.json()["detail"]


async def test_no_restriction_when_milestone_is_predecessor(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    m = await _create_milestone(client, project, live_schedule_period, "Design freeze", "finish_milestone")
    b = await _create_activity(client, project, live_schedule_period, "Piling")
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": m["id"], "successor_id": b["id"], "relationship_type": "SS",
    })
    assert resp.status_code == 201, resp.text


# --- Amending relationships when an activity's own type changes (2026-07-07,
# per Maro: warn then amend on confirmation, rather than leaving stale/
# nonsensical relationship types after a type change) --------------------------

async def test_changing_to_start_milestone_flags_conflicting_relationships(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Design freeze", "finish_milestone")
    await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "FS",
    })

    resp = await client.patch(f"/api/v1/activities/{m['id']}", json={"activity_type": "start_milestone"})
    assert resp.status_code == 409, resp.text
    assert "Start Milestone" in resp.json()["detail"]
    assert "FS" in resp.json()["detail"] and "SS" in resp.json()["detail"]

    # Rejected outright — the type change itself must not have gone through.
    unchanged = await client.get(f"/api/v1/activities/{m['id']}")
    assert unchanged.json()["activity_type"] == "finish_milestone"


async def test_amend_relationships_true_fixes_conflicts_and_applies_type_change(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Design freeze", "finish_milestone")
    rel = (await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "FS",
    })).json()

    resp = await client.patch(f"/api/v1/activities/{m['id']}", json={
        "activity_type": "start_milestone", "amend_relationships": True,
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["activity_type"] == "start_milestone"

    listing = (await client.get(
        "/api/v1/activity-relationships/", params={"schedule_period_id": str(live_schedule_period.id)}
    )).json()
    amended = next(r for r in listing if r["id"] == rel["id"])
    assert amended["relationship_type"] == "SS"  # first letter flipped F->S, second left as-is


async def test_changing_type_with_no_conflicting_relationships_needs_no_amendment(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Excavation")
    m = await _create_milestone(client, project, live_schedule_period, "Mobilisation started", "start_milestone")
    await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": m["id"], "relationship_type": "SS",
    })

    # Switching to a plain task, which has no relationship-type restriction at
    # all — no conflict regardless of what the existing link's type is.
    resp = await client.patch(f"/api/v1/activities/{m['id']}", json={"activity_type": "task", "duration_hours": 8})
    assert resp.status_code == 200, resp.text
