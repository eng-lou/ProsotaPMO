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
    # is_critical/total_float are computed by the (not-yet-built) CPM engine,
    # never accepted as input — see app/services/activity.py:_apply_computed_fields.
    assert data["is_critical"] is None
    assert data["total_float"] is None
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
        "is_critical": True,
        "total_float": 5,
        "bl_start": "2025-01-01",
        "bl_finish": "2025-02-01",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["is_critical"] is None
    assert data["total_float"] is None
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
    assert resp.json()["duration_days"] == 0


async def test_milestone_rejects_nonzero_duration(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "Bad milestone",
        "activity_type": "milestone",
        "duration_days": 5,
    })
    assert resp.status_code == 422


async def test_variance_days_computed_from_finish_vs_baseline(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    from datetime import date

    activity = Activity(
        project_id=project.id,
        period_id=live_period.id,
        task_name="Piling",
        code="ACT-9999",
        bl_finish=date(2025, 5, 1),
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    resp = await client.patch(f"/api/v1/activities/{activity.id}", json={"finish": "2025-05-08"})
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


async def test_update_activity_partial(client: AsyncClient, project: Project, live_period: Period):
    create = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "task_name": "Original",
        "duration_days": 10,
    })
    activity_id = create.json()["id"]

    resp = await client.patch(f"/api/v1/activities/{activity_id}", json={"duration_days": 15})
    assert resp.status_code == 200
    data = resp.json()
    assert data["task_name"] == "Original"     # unchanged
    assert data["duration_days"] == 15         # updated


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
    parent = await _create(client, project, live_period, task_name="Phase 1")
    await _create(
        client, project, live_period, task_name="Piling", parent_id=parent["id"],
        start="2025-03-01", finish="2025-04-01", duration_days=31, pct_complete=100,
    )
    await _create(
        client, project, live_period, task_name="Pile caps", parent_id=parent["id"],
        start="2025-04-01", finish="2025-05-01", duration_days=30, pct_complete=0,
    )

    resp = await client.get(f"/api/v1/activities/{parent['id']}")
    data = resp.json()
    assert data["start"] == "2025-03-01"
    assert data["finish"] == "2025-05-01"
    assert data["duration_days"] == 61
    # Duration-weighted average: (31*100 + 30*0) / 61 = 50.82
    assert 50 < float(data["pct_complete"]) < 51


async def test_delete_summary_cascades_to_children(
    client: AsyncClient, project: Project, live_period: Period
):
    parent = await _create(client, project, live_period, task_name="Phase 1")
    child = await _create(client, project, live_period, task_name="Piling", parent_id=parent["id"])

    resp = await client.delete(f"/api/v1/activities/{parent['id']}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/v1/activities/{child['id']}")
    assert resp.status_code == 404


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
