from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.period import Period
from app.models.project import Project


async def test_create_activity(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "Excavation works",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["task_name"] == "Excavation works"
    # is_critical/total_float_hours/start/finish are computed by the CPM engine
    # (Phase 5), never accepted as input — see app/services/scheduling_cpm.py. A lone
    # activity with no predecessors/successors is trivially on the critical path (it
    # alone determines the project finish date), so total_float_hours is genuinely 0.
    assert data["is_critical"] is True
    assert float(data["total_float_hours"]) == 0.0
    assert data["start"] is not None
    assert data["finish"] is not None
    assert data["code"] == "ACT-0001"
    assert "id" in data
    assert data["project_id"] == str(project.id)


async def test_create_activity_ignores_computed_fields(
    client: AsyncClient, project: Project, live_period: Period
):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "Piling",
        "is_critical": False,
        "total_float_hours": 99,
        "start": "1999-01-01T00:00:00",
        "finish": "1999-01-01T00:00:00",
        "bl_start": "2025-01-01T00:00:00",
        "bl_finish": "2025-02-01T00:00:00",
    })
    assert resp.status_code == 201
    data = resp.json()
    # Real CPM-computed values, not the (ignored) posted junk.
    assert data["is_critical"] is True
    assert float(data["total_float_hours"]) == 0.0
    assert data["start"] != "1999-01-01T00:00:00"
    assert data["bl_start"] is None
    assert data["bl_finish"] is None


async def test_milestone_forces_zero_duration(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "Practical Completion",
        "activity_type": "milestone",
    })
    assert resp.status_code == 201
    assert float(resp.json()["duration_days"]) == 0.0


async def test_milestone_rejects_nonzero_duration(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "Bad milestone",
        "activity_type": "milestone",
        "duration_hours": 5,
    })
    assert resp.status_code == 422


async def test_variance_days_computed_from_finish_vs_baseline(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    from datetime import date, datetime

    # A Monday anchor + a 5-day (Mon-Fri) duration keeps the CPM-computed finish
    # deterministic without needing to replicate working-day-skipping arithmetic here.
    live_period.start_date = date(2025, 6, 2)
    await db.commit()

    create = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "task_name": "Piling", "duration_hours": 40,
    })
    assert create.status_code == 201
    activity_id = create.json()["id"]
    assert create.json()["finish"] == "2025-06-06T17:00:00"  # Friday close of that week

    activity = await db.get(Activity, uuid.UUID(activity_id))
    activity.bl_finish = datetime(2025, 5, 30)
    await db.commit()

    resp = await client.patch(f"/api/v1/activities/{activity_id}", json={"task_name": "Piling (renamed)"})
    assert resp.status_code == 200
    assert resp.json()["variance_days"] == 7


async def test_list_activities_by_project(client: AsyncClient, project: Project, live_period: Period):
    for name in ["Piling", "Groundworks"]:
        await client.post("/api/v1/activities/", json={
            "project_id": str(project.id),
            "period_id": str(live_period.id),
            "task_name": name,
        })

    resp = await client.get("/api/v1/activities/", params={"project_id": str(project.id)})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_list_activities_excludes_other_projects(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, org
):
    await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "Belongs to project A",
    })

    other_project = Project(org_id=org.id, name="Other Project")
    db.add(other_project)
    await db.commit()
    await db.refresh(other_project)

    resp = await client.get("/api/v1/activities/", params={"project_id": str(other_project.id)})
    assert resp.status_code == 200
    assert len(resp.json()) == 0


async def test_list_activities_filter_by_period(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, frozen_period: Period
):
    await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "In live period",
    })
    # Insert directly to frozen period (bypassing API freeze check)
    frozen_activity = Activity(
        project_id=project.id, period_id=frozen_period.id, task_name="In frozen period", code="ACT-9001"
    )
    db.add(frozen_activity)
    await db.commit()

    resp = await client.get("/api/v1/activities/", params={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
    })
    assert resp.status_code == 200
    names = [a["task_name"] for a in resp.json()]
    assert names == ["In live period"]


async def test_get_activity(client: AsyncClient, project: Project, live_period: Period):
    create = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "Steel erection",
    })
    activity_id = create.json()["id"]

    resp = await client.get(f"/api/v1/activities/{activity_id}")
    assert resp.status_code == 200
    assert resp.json()["task_name"] == "Steel erection"


async def test_get_activity_not_found(client: AsyncClient):
    resp = await client.get(f"/api/v1/activities/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_update_activity(client: AsyncClient, project: Project, live_period: Period):
    create = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "Original name",
        "pct_complete": "25.00",
    })
    activity_id = create.json()["id"]

    resp = await client.patch(f"/api/v1/activities/{activity_id}", json={
        "task_name": "Updated name",
        "pct_complete": "75.00",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["task_name"] == "Updated name"
    assert float(data["pct_complete"]) == 75.0


async def test_update_code_to_unique_value(client: AsyncClient, project: Project, live_period: Period):
    create = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Piling",
    })
    activity_id = create.json()["id"]

    resp = await client.patch(f"/api/v1/activities/{activity_id}", json={"code": "PILE-01"})
    assert resp.status_code == 200
    assert resp.json()["code"] == "PILE-01"


async def test_update_code_rejects_duplicate(client: AsyncClient, project: Project, live_period: Period):
    a = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Excavation",
    })
    b = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "task_name": "Piling",
    })
    resp = await client.patch(f"/api/v1/activities/{b.json()['id']}", json={"code": a.json()["code"]})
    assert resp.status_code == 422
    assert "already in use" in resp.json()["detail"].lower()


async def test_update_activity_partial(client: AsyncClient, project: Project, live_period: Period):
    create = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "Original",
        "duration_hours": 80,
    })
    activity_id = create.json()["id"]

    resp = await client.patch(f"/api/v1/activities/{activity_id}", json={"duration_hours": 120})
    assert resp.status_code == 200
    data = resp.json()
    assert data["task_name"] == "Original"           # unchanged
    assert float(data["duration_hours"]) == 120.0    # updated
    assert float(data["duration_days"]) == 15.0      # computed display (120h / 8h per day)


async def test_delete_activity(client: AsyncClient, project: Project, live_period: Period):
    create = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "To be deleted",
    })
    activity_id = create.json()["id"]

    resp = await client.delete(f"/api/v1/activities/{activity_id}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/v1/activities/{activity_id}")
    assert resp.status_code == 404


async def test_create_rejects_frozen_period(client: AsyncClient, project: Project, frozen_period: Period):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(frozen_period.id),
        "task_name": "Should be rejected",
    })
    assert resp.status_code == 422
    assert "frozen" in resp.json()["detail"].lower()


async def test_update_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, frozen_period: Period
):
    activity = Activity(
        project_id=project.id, period_id=frozen_period.id, task_name="Frozen activity", code="ACT-9002"
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    resp = await client.patch(f"/api/v1/activities/{activity.id}", json={"task_name": "Attempt edit"})
    assert resp.status_code == 422


async def test_delete_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, frozen_period: Period
):
    activity = Activity(
        project_id=project.id, period_id=frozen_period.id, task_name="Frozen activity", code="ACT-9002"
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    resp = await client.delete(f"/api/v1/activities/{activity.id}")
    assert resp.status_code == 422


# --- WBS hierarchy (Phase 2) -------------------------------------------------

async def _create(client: AsyncClient, project: Project, period: Period, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "task_name": "Activity"}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_wbs_path_assigned_from_outline_position(
    client: AsyncClient, project: Project, live_period: Period
):
    a = await _create(client, project, live_period, task_name="Phase 1")
    b = await _create(client, project, live_period, task_name="Phase 2")
    assert a["wbs_path"] == "1"
    assert b["wbs_path"] == "2"

    child = await _create(client, project, live_period, task_name="Piling", parent_id=a["id"])
    assert child["wbs_path"] == "1.1"


# --- Move up/down (reorder among siblings, independent of hierarchy level) --

async def test_move_down_swaps_with_next_sibling(client: AsyncClient, project: Project, live_period: Period):
    a = await _create(client, project, live_period, task_name="Phase 1")
    b = await _create(client, project, live_period, task_name="Phase 2")

    resp = await client.post(f"/api/v1/activities/{a['id']}/move", json={"direction": "down"})
    assert resp.status_code == 200

    listing = (await client.get("/api/v1/activities/", params={"project_id": str(project.id)})).json()
    names = [x["task_name"] for x in listing]
    assert names == ["Phase 2", "Phase 1"]
    by_name = {x["task_name"]: x for x in listing}
    assert by_name["Phase 2"]["wbs_path"] == "1"
    assert by_name["Phase 1"]["wbs_path"] == "2"


async def test_move_up_swaps_with_previous_sibling(client: AsyncClient, project: Project, live_period: Period):
    a = await _create(client, project, live_period, task_name="Phase 1")
    await _create(client, project, live_period, task_name="Phase 2")
    c = await _create(client, project, live_period, task_name="Phase 3")

    resp = await client.post(f"/api/v1/activities/{c['id']}/move", json={"direction": "up"})
    assert resp.status_code == 200

    listing = (await client.get("/api/v1/activities/", params={"project_id": str(project.id)})).json()
    assert [x["task_name"] for x in listing] == ["Phase 1", "Phase 3", "Phase 2"]
    _ = a


async def test_move_up_at_top_is_a_noop(client: AsyncClient, project: Project, live_period: Period):
    a = await _create(client, project, live_period, task_name="Phase 1")
    await _create(client, project, live_period, task_name="Phase 2")

    resp = await client.post(f"/api/v1/activities/{a['id']}/move", json={"direction": "up"})
    assert resp.status_code == 200

    listing = (await client.get("/api/v1/activities/", params={"project_id": str(project.id)})).json()
    assert [x["task_name"] for x in listing] == ["Phase 1", "Phase 2"]


async def test_move_down_at_bottom_is_a_noop(client: AsyncClient, project: Project, live_period: Period):
    await _create(client, project, live_period, task_name="Phase 1")
    b = await _create(client, project, live_period, task_name="Phase 2")

    resp = await client.post(f"/api/v1/activities/{b['id']}/move", json={"direction": "down"})
    assert resp.status_code == 200

    listing = (await client.get("/api/v1/activities/", params={"project_id": str(project.id)})).json()
    assert [x["task_name"] for x in listing] == ["Phase 1", "Phase 2"]


async def test_move_only_reorders_within_same_parent(client: AsyncClient, project: Project, live_period: Period):
    parent1 = await _create(client, project, live_period, task_name="Phase 1")
    parent2 = await _create(client, project, live_period, task_name="Phase 2")
    child = await _create(client, project, live_period, task_name="Piling", parent_id=parent1["id"])

    # Only one child under Phase 1 — moving it down (no sibling to swap with under
    # the same parent) must not reach across into Phase 2's children.
    resp = await client.post(f"/api/v1/activities/{child['id']}/move", json={"direction": "down"})
    assert resp.status_code == 200

    listing = (await client.get("/api/v1/activities/", params={"project_id": str(project.id)})).json()
    by_name = {x["task_name"]: x for x in listing}
    assert by_name["Piling"]["parent_id"] == parent1["id"]
    assert by_name["Piling"]["wbs_path"] == "1.1"
    _ = parent2


async def test_move_rejects_frozen_period(
    client: AsyncClient, db: AsyncSession, project: Project, frozen_period: Period
):
    activity = Activity(
        project_id=project.id, period_id=frozen_period.id, task_name="Frozen activity", code="ACT-9003"
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    resp = await client.post(f"/api/v1/activities/{activity.id}/move", json={"direction": "up"})
    assert resp.status_code == 422


async def test_indent_promotes_parent_to_wbs_summary(
    client: AsyncClient, project: Project, live_period: Period
):
    parent = await _create(client, project, live_period, task_name="Phase 1")
    assert parent["activity_type"] == "task"

    await _create(client, project, live_period, task_name="Piling", parent_id=parent["id"])

    resp = await client.get(f"/api/v1/activities/{parent['id']}")
    assert resp.json()["activity_type"] == "wbs_summary"


async def test_outdent_demotes_back_to_task(client: AsyncClient, project: Project, live_period: Period):
    parent = await _create(client, project, live_period, task_name="Phase 1")
    child = await _create(client, project, live_period, task_name="Piling", parent_id=parent["id"])

    resp = await client.patch(f"/api/v1/activities/{child['id']}", json={"parent_id": None})
    assert resp.status_code == 200

    resp = await client.get(f"/api/v1/activities/{parent['id']}")
    assert resp.json()["activity_type"] == "task"


async def test_reparent_rejects_cycle(client: AsyncClient, project: Project, live_period: Period):
    grandparent = await _create(client, project, live_period, task_name="Phase 1")
    parent = await _create(client, project, live_period, task_name="Sub-phase", parent_id=grandparent["id"])

    # Attempt to make the grandparent a child of its own descendant.
    resp = await client.patch(f"/api/v1/activities/{grandparent['id']}", json={"parent_id": parent["id"]})
    assert resp.status_code == 422
    assert "cycle" in resp.json()["detail"].lower()


async def test_reparent_to_self_rejected(client: AsyncClient, project: Project, live_period: Period):
    a = await _create(client, project, live_period, task_name="Solo")
    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={"parent_id": a["id"]})
    assert resp.status_code == 422


async def test_wbs_summary_rollup_from_children(client: AsyncClient, project: Project, live_period: Period):
    # Dates are CPM-computed (Phase 5) rather than typed in, so this asserts the
    # rollup formula against whatever the two children actually compute to, linked
    # FS so child2 genuinely starts after child1 (exercising min-start/max-finish
    # rather than two independent, potentially-identical-start activities).
    parent = await _create(client, project, live_period, task_name="Phase 1")
    child1 = await _create(
        client, project, live_period, task_name="Piling", parent_id=parent["id"],
        duration_hours=80, pct_complete=100,
    )
    child2 = await _create(
        client, project, live_period, task_name="Pile caps", parent_id=parent["id"],
        duration_hours=40, pct_complete=0,
    )
    await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": child1["id"], "successor_id": child2["id"],
    })

    c1 = (await client.get(f"/api/v1/activities/{child1['id']}")).json()
    c2 = (await client.get(f"/api/v1/activities/{child2['id']}")).json()
    resp = await client.get(f"/api/v1/activities/{parent['id']}")
    data = resp.json()

    assert data["start"] == c1["start"]
    assert data["finish"] == c2["finish"]
    # Duration-weighted average: (10*100 + 5*0) / 15 = 66.67
    assert 66 < float(data["pct_complete"]) < 67


async def test_delete_summary_cascades_to_children(
    client: AsyncClient, project: Project, live_period: Period
):
    parent = await _create(client, project, live_period, task_name="Phase 1")
    child = await _create(client, project, live_period, task_name="Piling", parent_id=parent["id"])

    resp = await client.delete(f"/api/v1/activities/{parent['id']}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/v1/activities/{child['id']}")
    assert resp.status_code == 404


async def test_delete_without_cascade_promotes_children(
    client: AsyncClient, project: Project, live_period: Period
):
    grandparent = await _create(client, project, live_period, task_name="Project")
    parent = await _create(client, project, live_period, task_name="Phase 1", parent_id=grandparent["id"])
    child = await _create(client, project, live_period, task_name="Piling", parent_id=parent["id"])

    resp = await client.delete(f"/api/v1/activities/{parent['id']}", params={"cascade": "false"})
    assert resp.status_code == 204

    # Parent is gone, but the child survives, now level with what were the parent's
    # own siblings — i.e. parented directly under the grandparent.
    resp = await client.get(f"/api/v1/activities/{parent['id']}")
    assert resp.status_code == 404

    resp = await client.get(f"/api/v1/activities/{child['id']}")
    assert resp.status_code == 200
    assert resp.json()["parent_id"] == grandparent["id"]


async def test_delete_without_cascade_promotes_children_to_root(
    client: AsyncClient, project: Project, live_period: Period
):
    parent = await _create(client, project, live_period, task_name="Phase 1")
    child = await _create(client, project, live_period, task_name="Piling", parent_id=parent["id"])

    resp = await client.delete(f"/api/v1/activities/{parent['id']}", params={"cascade": "false"})
    assert resp.status_code == 204

    resp = await client.get(f"/api/v1/activities/{child['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["parent_id"] is None
    assert data["activity_type"] == "task"  # no longer anyone's child, no longer a summary


async def test_list_activities_returns_outline_order(
    client: AsyncClient, project: Project, live_period: Period
):
    phase1 = await _create(client, project, live_period, task_name="Phase 1")
    await _create(client, project, live_period, task_name="Phase 2")
    await _create(client, project, live_period, task_name="Piling", parent_id=phase1["id"])

    resp = await client.get("/api/v1/activities/", params={"project_id": str(project.id)})
    names = [a["task_name"] for a in resp.json()]
    # Piling (child of Phase 1) must appear immediately after Phase 1, before Phase 2.
    assert names == ["Phase 1", "Piling", "Phase 2"]


# --- Reassessment log (Phase 8, reusing the shared polymorphic pattern) ------

async def test_log_reassessment_against_activity(client: AsyncClient, project: Project, live_period: Period):
    activity = await _create(client, project, live_period, task_name="Piling", duration_hours=40)

    resp = await client.post("/api/v1/reassessments/", json={
        "record_type": "activity", "record_id": activity["id"],
        "note": "Duration extended from 5 to 8 days following a revised piling sequence.",
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["record_type"] == "activity"

    resp = await client.get("/api/v1/reassessments/", params={
        "record_type": "activity", "record_id": activity["id"],
    })
    assert resp.status_code == 200
    assert len(resp.json()) == 1


# --- Finish stays anchored to the full plan regardless of progress ----------

async def test_partial_progress_does_not_shrink_finish(
    client: AsyncClient, project: Project, live_period: Period
):
    """Per Maro's correction: Finish stays anchored to the full planned
    duration regardless of progress — logging progress isn't evidence of
    finishing early. remaining_duration_hours is informational only.
    actual_start/actual_finish auto-set was tried and reverted (per Maro):
    once actual_finish got set, the CPM engine treats it as a permanent hard
    override, which froze Finish and stopped responding to later duration or
    progress edits entirely — not what was wanted."""
    activity = await _create(client, project, live_period, task_name="Piling", duration_hours=80)
    planned_finish = activity["finish"]

    resp = await client.patch(f"/api/v1/activities/{activity['id']}", json={"pct_complete": "50"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["finish"] == planned_finish
    assert float(data["remaining_duration_hours"]) == 40.0

    # Duration is still fully live/editable at any progress level — the exact
    # regression the auto-set behaviour caused.
    resp = await client.patch(f"/api/v1/activities/{activity['id']}", json={"duration_hours": 160})
    assert resp.status_code == 200
    assert resp.json()["finish"] != planned_finish
