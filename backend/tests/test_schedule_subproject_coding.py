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


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _get(client: AsyncClient, activity_id: str) -> dict:
    resp = await client.get(f"/api/v1/activities/{activity_id}")
    assert resp.status_code == 200
    return resp.json()


async def _code_history(client: AsyncClient, activity_id: str) -> list[dict]:
    resp = await client.get(f"/api/v1/activities/{activity_id}/code-history")
    assert resp.status_code == 200
    return resp.json()


async def _tag_subproject(client: AsyncClient, project: Project, root: dict, name: str) -> dict:
    resp = await client.post("/api/v1/schedule-subprojects/", json={
        "project_id": str(project.id), "name": name, "root_wbs_id": root["id"],
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _make_branch(client: AsyncClient, project: Project, period: SchedulePeriod) -> tuple[dict, dict]:
    top = await _create_activity(client, project, period, "Programme")
    branch = await _create_activity(client, project, period, "Enabling Works", parent_id=top["id"])
    await _create_activity(client, project, period, "Task", parent_id=branch["id"], duration_hours=8)
    branch = await _get(client, branch["id"])
    assert branch["wbs_role"] == "W"
    return top, branch


async def test_tagging_assigns_sp_code_and_logs_history(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    _top, branch = await _make_branch(client, project, live_schedule_period)

    await _tag_subproject(client, project, branch, "Enabling Works")

    tagged = await _get(client, branch["id"])
    assert tagged["wbs_role"] == "SP"
    assert tagged["code"] == "SP-0001"

    history = await _code_history(client, branch["id"])
    assert history[0]["old_code"] == "W-0001"
    assert history[0]["new_code"] == "SP-0001"
    assert history[0]["reason"] == "tagged_subproject"


async def test_children_keep_normal_codes_when_root_is_tagged(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Programme")
    branch = await _create_activity(client, project, live_schedule_period, "Enabling Works", parent_id=top["id"])
    task = await _create_activity(client, project, live_schedule_period, "Task", parent_id=branch["id"], duration_hours=8)

    await _tag_subproject(client, project, branch, "Enabling Works")

    tagged = await _get(client, branch["id"])
    child = await _get(client, task["id"])
    assert tagged["code"] == "SP-0001"
    assert child["wbs_role"] == "T"
    assert child["code"].startswith("T-")


async def test_untagging_freezes_the_code_and_logs_history(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    _top, branch = await _make_branch(client, project, live_schedule_period)
    created = await _tag_subproject(client, project, branch, "Enabling Works")

    tagged = await _get(client, branch["id"])
    assert tagged["code"] == "SP-0001"

    del_resp = await client.delete(f"/api/v1/schedule-subprojects/{created['id']}")
    assert del_resp.status_code in (200, 204)

    untagged = await _get(client, branch["id"])
    # Code freezes — does NOT revert to a fresh W-#### (docs/SUBPROJECT_FLOAT_PLAN.md §E).
    assert untagged["code"] == "SP-0001"
    assert untagged["wbs_role"] == "SP"

    history = await _code_history(client, branch["id"])
    assert history[0]["old_code"] == "SP-0001"
    assert history[0]["new_code"] == "SP-0001"
    assert history[0]["reason"] == "untagged_subproject"


async def test_nested_subproject_gets_its_own_independent_sp_code(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Hospital Project")
    enabling = await _create_activity(client, project, live_schedule_period, "Enabling Works", parent_id=top["id"])
    individual = await _create_activity(client, project, live_schedule_period, "Individual Project A", parent_id=enabling["id"])
    await _create_activity(client, project, live_schedule_period, "Inner Task", parent_id=individual["id"], duration_hours=8)

    await _tag_subproject(client, project, enabling, "Enabling Works")
    await _tag_subproject(client, project, individual, "Individual Project A")

    enabling_after = await _get(client, enabling["id"])
    individual_after = await _get(client, individual["id"])
    assert enabling_after["code"] == "SP-0001"
    assert individual_after["code"] == "SP-0002"  # shared SP- counter, not a separate per-branch one


async def test_moving_a_subproject_to_a_new_root_freezes_the_old_and_tags_the_new(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Programme")
    branch_a = await _create_activity(client, project, live_schedule_period, "Branch A", parent_id=top["id"])
    await _create_activity(client, project, live_schedule_period, "Task A", parent_id=branch_a["id"], duration_hours=8)
    branch_b = await _create_activity(client, project, live_schedule_period, "Branch B", parent_id=top["id"])
    await _create_activity(client, project, live_schedule_period, "Task B", parent_id=branch_b["id"], duration_hours=8)

    created = await _tag_subproject(client, project, branch_a, "Branch A")
    branch_a_tagged = await _get(client, branch_a["id"])
    assert branch_a_tagged["code"] == "SP-0001"

    update_resp = await client.patch(f"/api/v1/schedule-subprojects/{created['id']}", json={
        "name": "Branch A", "root_wbs_id": branch_b["id"],
    })
    assert update_resp.status_code == 200, update_resp.text

    branch_a_after = await _get(client, branch_a["id"])
    branch_b_after = await _get(client, branch_b["id"])
    # Old root frozen at its SP- code (like untagging), new root gets its own.
    assert branch_a_after["code"] == "SP-0001"
    history_a = await _code_history(client, branch_a["id"])
    assert history_a[0]["reason"] == "untagged_subproject"
    assert branch_b_after["code"] == "SP-0002"
    history_b = await _code_history(client, branch_b["id"])
    assert history_b[0]["reason"] == "tagged_subproject"
