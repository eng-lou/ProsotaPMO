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


async def _make_wbs_summary(client: AsyncClient, project: Project, period: SchedulePeriod) -> tuple[dict, dict]:
    """A parent with one child — the child is what actually gives the parent
    its wbs_summary status (activity_type is purely structural, see
    app/services/activity.py:_recompute_hierarchy)."""
    parent = await _create_activity(client, project, period, "Parent WBS")
    child = await _create_activity(client, project, period, "Child Task", parent_id=parent["id"], duration_hours=8)
    parent = await _get(client, parent["id"])
    assert parent["activity_type"] == "wbs_summary"
    return parent, child


async def test_duration_locked_on_wbs_summary(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    resp = await client.patch(f"/api/v1/activities/{parent['id']}", json={"duration_hours": 16})
    assert resp.status_code == 422
    assert "Duration" in resp.json()["detail"]


async def test_finish_locked_on_wbs_summary(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    parent = await _get(client, parent["id"])
    resp = await client.patch(f"/api/v1/activities/{parent['id']}", json={"finish": parent["finish"]})
    assert resp.status_code == 422
    assert "Finish" in resp.json()["detail"]


async def test_pct_complete_locked_on_wbs_summary(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    resp = await client.patch(f"/api/v1/activities/{parent['id']}", json={"pct_complete": 50})
    assert resp.status_code == 422
    assert "% Complete" in resp.json()["detail"]


async def test_constraint_locked_on_wbs_summary(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    resp = await client.patch(f"/api/v1/activities/{parent['id']}", json={
        "constraint_type": "ms", "constraint_date": "2025-06-10T08:00:00",
    })
    assert resp.status_code == 422
    assert "Constraint" in resp.json()["detail"]


async def test_calendar_locked_on_wbs_summary(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    cal_resp = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Night Shift", "day_start_time": "20:00", "day_end_time": "23:59",
    })
    assert cal_resp.status_code == 201, cal_resp.text
    resp = await client.patch(f"/api/v1/activities/{parent['id']}", json={"calendar_id": cal_resp.json()["id"]})
    assert resp.status_code == 422
    assert "Calendar" in resp.json()["detail"]


async def test_type_locked_on_wbs_summary(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    resp = await client.patch(f"/api/v1/activities/{parent['id']}", json={"activity_type": "task"})
    assert resp.status_code == 422
    assert "Type" in resp.json()["detail"]


async def test_echoing_the_same_type_back_is_not_rejected(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """The form always sends activity_type on every save, even a plain rename
    — that harmless no-op must not be treated as an attempted change."""
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    resp = await client.patch(f"/api/v1/activities/{parent['id']}", json={
        "task_name": "Renamed", "activity_type": "wbs_summary",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["task_name"] == "Renamed"


async def test_name_and_commentary_still_editable_on_wbs_summary(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    resp = await client.patch(f"/api/v1/activities/{parent['id']}", json={
        "task_name": "Renamed Parent", "commentary": "a note",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["task_name"] == "Renamed Parent"
    assert resp.json()["commentary"] == "a note"


async def test_fields_unlock_once_demoted_back_to_task(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """Removing the last child auto-demotes the parent back to a plain task
    (_recompute_hierarchy) — at that point duration/etc. are editable again,
    exactly the "unless it's been demoted to a regular task" case."""
    await _anchor(db, live_schedule_period)
    parent, child = await _make_wbs_summary(client, project, live_schedule_period)

    del_resp = await client.delete(f"/api/v1/activities/{child['id']}")
    assert del_resp.status_code in (200, 204)

    parent = await _get(client, parent["id"])
    assert parent["activity_type"] == "task"

    resp = await client.patch(f"/api/v1/activities/{parent['id']}", json={"duration_hours": 24})
    assert resp.status_code == 200, resp.text
    assert float(resp.json()["duration_hours"]) == 24.0


async def test_relationship_rejected_with_wbs_summary_as_predecessor(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    other = await _create_activity(client, project, live_schedule_period, "Other Task", duration_hours=8)
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": parent["id"], "successor_id": other["id"],
    })
    assert resp.status_code == 422
    assert "WBS/Project summary" in resp.json()["detail"]


async def test_relationship_rejected_with_wbs_summary_as_successor(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    other = await _create_activity(client, project, live_schedule_period, "Other Task", duration_hours=8)
    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": other["id"], "successor_id": parent["id"],
    })
    assert resp.status_code == 422
    assert "WBS/Project summary" in resp.json()["detail"]


async def test_resource_assignment_allowed_on_wbs_summary(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """2026-07-08, per Maro: reverses the earlier decision that only a WBS
    summary's children could carry resourcing — a summary can now be resourced
    directly (e.g. a prelims/overhead-style cost attached to a whole package),
    affecting its own cost rollup rather than only leaf-activity level."""
    await _anchor(db, live_schedule_period)
    parent, _child = await _make_wbs_summary(client, project, live_schedule_period)
    res_resp = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "45",
    })
    assert res_resp.status_code == 201, res_resp.text
    resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": parent["id"], "resource_id": res_resp.json()["id"], "utilisation_pct": 100,
    })
    assert resp.status_code == 201, resp.text
    assert float(resp.json()["budget"]) > 0
