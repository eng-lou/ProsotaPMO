from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schedule_period import SchedulePeriod
from app.models.project import Project

# Same anchor convention as test_scheduling_cpm.py — Standard Calendar is
# 08:00-17:00 with a 12:00-13:00 lunch (net 8h/day).
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


async def _tag_subproject(client: AsyncClient, project: Project, root: dict, name: str) -> dict:
    resp = await client.post("/api/v1/schedule-subprojects/", json={
        "project_id": str(project.id), "name": name, "root_wbs_id": root["id"],
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_rejects_top_level_wbs_root(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Whole Project")
    await _create_activity(client, project, live_schedule_period, "Task A", parent_id=top["id"], duration_hours=8)
    top = await _get(client, top["id"])
    assert top["activity_type"] == "wbs_summary"
    assert top["parent_id"] is None  # top-level ("P-") — not taggable

    resp = await client.post("/api/v1/schedule-subprojects/", json={
        "project_id": str(project.id), "name": "Bad", "root_wbs_id": top["id"],
    })
    assert resp.status_code == 422


async def test_create_rejects_non_wbs_root(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    task = await _create_activity(client, project, live_schedule_period, "A Plain Task", duration_hours=8)
    resp = await client.post("/api/v1/schedule-subprojects/", json={
        "project_id": str(project.id), "name": "Bad", "root_wbs_id": task["id"],
    })
    assert resp.status_code == 422


async def test_create_rejects_duplicate_tagging(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Top")
    branch = await _create_activity(client, project, live_schedule_period, "Branch", parent_id=top["id"])
    await _create_activity(client, project, live_schedule_period, "Task", parent_id=branch["id"], duration_hours=8)

    await _tag_subproject(client, project, branch, "Branch A")
    resp = await client.post("/api/v1/schedule-subprojects/", json={
        "project_id": str(project.id), "name": "Branch A Again", "root_wbs_id": branch["id"],
    })
    assert resp.status_code == 422


async def test_crud_list_update_delete(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Top")
    branch = await _create_activity(client, project, live_schedule_period, "Branch", parent_id=top["id"])
    await _create_activity(client, project, live_schedule_period, "Task", parent_id=branch["id"], duration_hours=8)

    created = await _tag_subproject(client, project, branch, "Original Name")
    listing = (await client.get("/api/v1/schedule-subprojects/", params={"project_id": str(project.id)})).json()
    assert any(sp["id"] == created["id"] for sp in listing)

    update_resp = await client.patch(f"/api/v1/schedule-subprojects/{created['id']}", json={
        "name": "Renamed", "root_wbs_id": branch["id"],
    })
    assert update_resp.status_code == 200, update_resp.text
    assert update_resp.json()["name"] == "Renamed"

    del_resp = await client.delete(f"/api/v1/schedule-subprojects/{created['id']}")
    assert del_resp.status_code == 204
    listing = (await client.get("/api/v1/schedule-subprojects/", params={"project_id": str(project.id)})).json()
    assert all(sp["id"] != created["id"] for sp in listing)


async def test_tagged_branch_gets_own_zero_slack_float(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """The whole point of the feature: a short internal chain inside a much
    longer project shows real, tight sub-float even though the master pass
    (correctly) gives it huge float against the overall programme."""
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Hospital Project")
    branch = await _create_activity(client, project, live_schedule_period, "Enabling Works", parent_id=top["id"])
    a = await _create_activity(client, project, live_schedule_period, "Task A", parent_id=branch["id"], duration_hours=40)
    b = await _create_activity(client, project, live_schedule_period, "Task B", parent_id=branch["id"], duration_hours=40)
    await _link(client, a, b)

    # A long, unrelated chain elsewhere in the project — this is what gives
    # the branch above its large *master* float, the exact problem the
    # feature exists to surface.
    long_chain = [await _create_activity(client, project, live_schedule_period, f"Long {i}", duration_hours=80) for i in range(5)]
    for i in range(len(long_chain) - 1):
        await _link(client, long_chain[i], long_chain[i + 1])

    b_before = await _get(client, b["id"])
    assert float(b_before["total_float_hours"]) > 100  # drowned out by the long chain
    assert b_before["sub_total_float_hours"] is None  # not tagged yet

    await _tag_subproject(client, project, branch, "Enabling Works")

    a_after = await _get(client, a["id"])
    b_after = await _get(client, b["id"])
    assert float(a_after["sub_total_float_hours"]) == 0.0
    assert a_after["sub_is_critical"] is True
    assert float(b_after["sub_total_float_hours"]) == 0.0
    assert b_after["sub_is_critical"] is True
    # Master float is untouched by any of this.
    assert float(b_after["total_float_hours"]) == float(b_before["total_float_hours"])
    assert b_after["is_critical"] is False


async def test_nested_subprojects_innermost_owns_the_activity(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """Maro's actual example: a package (Enabling Works) containing further
    individually-governed sub-projects. An activity inside the innermost one
    should show *that* package's own float, not the outer one's."""
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Hospital Project")
    enabling = await _create_activity(client, project, live_schedule_period, "Enabling Works", parent_id=top["id"])
    individual = await _create_activity(client, project, live_schedule_period, "Individual Project A", parent_id=enabling["id"])
    inner_a = await _create_activity(client, project, live_schedule_period, "Inner Task A", parent_id=individual["id"], duration_hours=40)
    inner_b = await _create_activity(client, project, live_schedule_period, "Inner Task B", parent_id=individual["id"], duration_hours=40)
    await _link(client, inner_a, inner_b)
    # A direct child of Enabling Works, not inside the nested individual project.
    outer_task = await _create_activity(client, project, live_schedule_period, "Direct Enabling Task", parent_id=enabling["id"], duration_hours=16)

    await _tag_subproject(client, project, enabling, "Enabling Works")
    await _tag_subproject(client, project, individual, "Individual Project A")

    inner_b_after = await _get(client, inner_b["id"])
    outer_task_after = await _get(client, outer_task["id"])
    # inner_b's nearest tagged ancestor is Individual Project A, not Enabling
    # Works — it should be critical within its own, smaller package.
    assert float(inner_b_after["sub_total_float_hours"]) == 0.0
    assert inner_b_after["sub_is_critical"] is True
    # outer_task's nearest (and only) tagged ancestor is Enabling Works itself.
    assert outer_task_after["sub_total_float_hours"] is not None


async def test_untagging_clears_sub_float(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Top")
    branch = await _create_activity(client, project, live_schedule_period, "Branch", parent_id=top["id"])
    a = await _create_activity(client, project, live_schedule_period, "Task", parent_id=branch["id"], duration_hours=8)

    created = await _tag_subproject(client, project, branch, "Branch")
    a_tagged = await _get(client, a["id"])
    assert a_tagged["sub_total_float_hours"] is not None

    await client.delete(f"/api/v1/schedule-subprojects/{created['id']}")
    a_untagged = await _get(client, a["id"])
    assert a_untagged["sub_total_float_hours"] is None
    assert a_untagged["sub_is_critical"] is None


async def test_unrelated_subproject_is_not_recomputed_on_edit(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """Performance guard (docs/SUBPROJECT_FLOAT_PLAN.md §D.2): editing one
    branch must not blindly re-touch a completely unrelated tagged branch."""
    await _anchor(db, live_schedule_period)
    top = await _create_activity(client, project, live_schedule_period, "Top")

    branch_a = await _create_activity(client, project, live_schedule_period, "Branch A", parent_id=top["id"])
    a1 = await _create_activity(client, project, live_schedule_period, "A1", parent_id=branch_a["id"], duration_hours=40)
    a2 = await _create_activity(client, project, live_schedule_period, "A2", parent_id=branch_a["id"], duration_hours=40)
    await _link(client, a1, a2)
    await _tag_subproject(client, project, branch_a, "Branch A")

    branch_b = await _create_activity(client, project, live_schedule_period, "Branch B", parent_id=top["id"])
    b1 = await _create_activity(client, project, live_schedule_period, "B1", parent_id=branch_b["id"], duration_hours=40)
    await _tag_subproject(client, project, branch_b, "Branch B")

    b1_before = await _get(client, b1["id"])

    # Edit something in Branch A only.
    await client.patch(f"/api/v1/activities/{a1['id']}", json={"commentary": "note"})

    b1_after = await _get(client, b1["id"])
    assert b1_after["updated_at"] == b1_before["updated_at"]  # never touched
    assert b1_after["sub_total_float_hours"] == b1_before["sub_total_float_hours"]
