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


async def _create(client: AsyncClient, project: Project, period: SchedulePeriod, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": "Activity"}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_archive_actualises_and_reparents_under_archived_container(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create(client, project, live_schedule_period, task_name="Excavation", duration_hours=40, pct_complete=30)

    resp = await client.post(f"/api/v1/activities/{a['id']}/archive")
    assert resp.status_code == 200
    archived = next(x for x in resp.json() if x["id"] == a["id"])
    assert archived["is_archived"] is True
    assert float(archived["pct_complete"]) == 100.0
    assert archived["remaining_duration_hours"] == "0.00" or float(archived["remaining_duration_hours"]) == 0.0

    refreshed = (await client.get(f"/api/v1/activities/{a['id']}")).json()
    assert refreshed["is_archived"] is True
    assert refreshed["code"] == a["code"]  # code is never renumbered by archiving

    parent = next(x for x in (await client.get(
        "/api/v1/activities/", params={"project_id": project.id.__str__(), "schedule_period_id": str(live_schedule_period.id)}
    )).json() if x["id"] == refreshed["parent_id"])
    assert parent["is_archive_container"] is True
    assert parent["task_name"] == "Archived"


async def test_archive_strips_relationships(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    a = await _create(client, project, live_schedule_period, task_name="Excavation")
    b = await _create(client, project, live_schedule_period, task_name="Piling")
    rel = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })
    assert rel.status_code == 201

    await client.post(f"/api/v1/activities/{a['id']}/archive")

    listing = (await client.get(
        "/api/v1/activity-relationships/", params={"schedule_period_id": str(live_schedule_period.id)}
    )).json()
    assert listing == []


async def test_archive_excluded_from_critical_path(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create(client, project, live_schedule_period, task_name="Excavation")

    await client.post(f"/api/v1/activities/{a['id']}/archive")
    refreshed = (await client.get(f"/api/v1/activities/{a['id']}")).json()
    assert refreshed["is_critical"] is None
    assert refreshed["total_float_hours"] is None
    assert refreshed["free_float_hours"] is None


async def test_archive_cascade_archives_whole_subtree(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    parent = await _create(client, project, live_schedule_period, task_name="Development")
    child = await _create(client, project, live_schedule_period, task_name="Design", parent_id=parent["id"])

    resp = await client.post(f"/api/v1/activities/{parent['id']}/archive")
    assert resp.status_code == 200
    ids = {x["id"] for x in resp.json()}
    assert {parent["id"], child["id"]} <= ids

    refreshed_child = (await client.get(f"/api/v1/activities/{child['id']}")).json()
    assert refreshed_child["is_archived"] is True
    # The subtree stays intact under the archived parent, not individually
    # reparented under the container.
    assert refreshed_child["parent_id"] == parent["id"]


async def test_archive_without_cascade_promotes_children(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    parent = await _create(client, project, live_schedule_period, task_name="Development")
    child = await _create(client, project, live_schedule_period, task_name="Design", parent_id=parent["id"])

    resp = await client.post(f"/api/v1/activities/{parent['id']}/archive", params={"cascade": "false"})
    assert resp.status_code == 200

    refreshed_child = (await client.get(f"/api/v1/activities/{child['id']}")).json()
    assert refreshed_child["is_archived"] is False
    assert refreshed_child["parent_id"] is None  # promoted to the parent's own (root) level


async def test_multiple_archives_reuse_one_container(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create(client, project, live_schedule_period, task_name="Excavation")
    b = await _create(client, project, live_schedule_period, task_name="Piling")

    await client.post(f"/api/v1/activities/{a['id']}/archive")
    await client.post(f"/api/v1/activities/{b['id']}/archive")

    listing = (await client.get(
        "/api/v1/activities/", params={"project_id": project.id.__str__(), "schedule_period_id": str(live_schedule_period.id)}
    )).json()
    containers = [x for x in listing if x["is_archive_container"]]
    assert len(containers) == 1
    a_refreshed = next(x for x in listing if x["id"] == a["id"])
    b_refreshed = next(x for x in listing if x["id"] == b["id"])
    assert a_refreshed["parent_id"] == containers[0]["id"]
    assert b_refreshed["parent_id"] == containers[0]["id"]


async def test_deleting_baselined_activity_archives_instead(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create(client, project, live_schedule_period, task_name="Excavation")
    await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })

    resp = await client.delete(f"/api/v1/activities/{a['id']}")
    assert resp.status_code == 200
    assert resp.json() == {"archived": True}

    # Not actually deleted — archived, and still fetchable.
    refreshed = (await client.get(f"/api/v1/activities/{a['id']}")).json()
    assert refreshed["is_archived"] is True
    assert float(refreshed["pct_complete"]) == 100.0


async def test_deleting_non_baselined_activity_still_hard_deletes(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create(client, project, live_schedule_period, task_name="Excavation")
    resp = await client.delete(f"/api/v1/activities/{a['id']}")
    assert resp.status_code == 200
    assert resp.json() == {"archived": False}
    assert (await client.get(f"/api/v1/activities/{a['id']}")).status_code == 404


async def test_deleting_cascade_where_only_a_child_is_baselined_archives_whole_subtree(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """The parent itself was never captured in any baseline, but one of its
    children was — the whole subtree still archives rather than deleting,
    since a partial delete/archive split would leave the archived child
    orphaned under a parent that no longer exists."""
    await _anchor(db, live_schedule_period)
    parent = await _create(client, project, live_schedule_period, task_name="Development")
    child = await _create(client, project, live_schedule_period, task_name="Design", parent_id=parent["id"])
    await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })

    resp = await client.delete(f"/api/v1/activities/{parent['id']}")
    assert resp.status_code == 200
    assert resp.json() == {"archived": True}

    assert (await client.get(f"/api/v1/activities/{parent['id']}")).json()["is_archived"] is True
    assert (await client.get(f"/api/v1/activities/{child['id']}")).json()["is_archived"] is True


async def test_archive_container_cannot_be_archived_deleted_or_edited(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create(client, project, live_schedule_period, task_name="Excavation")
    await client.post(f"/api/v1/activities/{a['id']}/archive")
    listing = (await client.get(
        "/api/v1/activities/", params={"project_id": project.id.__str__(), "schedule_period_id": str(live_schedule_period.id)}
    )).json()
    container = next(x for x in listing if x["is_archive_container"])

    assert (await client.post(f"/api/v1/activities/{container['id']}/archive")).status_code == 422
    assert (await client.delete(f"/api/v1/activities/{container['id']}")).status_code == 422
    assert (await client.patch(
        f"/api/v1/activities/{container['id']}", json={"task_name": "Renamed"}
    )).status_code == 422


async def test_archive_container_stays_last_after_new_top_level_activity(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    """The container's own sort_order used to just be "current max + 1" at the
    moment it was created — a later top-level activity would then get an even
    higher sort_order and land after it (2026-07-04, per Maro: "I want that
    archived wbs to always be at the bottom"). _recompute_hierarchy now
    re-pins it past every other top-level sibling on every pass."""
    a = await _create(client, project, live_schedule_period, task_name="Excavation")
    await client.post(f"/api/v1/activities/{a['id']}/archive")

    b = await _create(client, project, live_schedule_period, task_name="Piling")

    listing = (await client.get(
        "/api/v1/activities/", params={"project_id": project.id.__str__(), "schedule_period_id": str(live_schedule_period.id)}
    )).json()
    top_level = [x for x in listing if x["parent_id"] is None]
    top_level.sort(key=lambda x: x["sort_order"])
    assert top_level[-1]["is_archive_container"] is True
    assert any(x["id"] == b["id"] for x in top_level[:-1])


async def test_duplicate_inserts_immediately_after_source(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    """Duplicate must place the copy right below its source — not appended at
    the group's current end, which could otherwise land it past the reserved
    Archive container or past unrelated later siblings (2026-07-04, per Maro)."""
    a = await _create(client, project, live_schedule_period, task_name="Excavation")
    b = await _create(client, project, live_schedule_period, task_name="Piling")

    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id),
        "task_name": "Excavation (copy)", "insert_after_id": a["id"],
    })
    assert resp.status_code == 201

    listing = (await client.get(
        "/api/v1/activities/", params={"project_id": project.id.__str__(), "schedule_period_id": str(live_schedule_period.id)}
    )).json()
    top_level = [x for x in listing if x["parent_id"] is None]
    top_level.sort(key=lambda x: x["sort_order"])
    names = [x["task_name"] for x in top_level]
    assert names == ["Excavation", "Excavation (copy)", "Piling"]


async def test_cannot_indent_activity_under_archive_container_directly(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    a = await _create(client, project, live_schedule_period, task_name="Excavation")
    await client.post(f"/api/v1/activities/{a['id']}/archive")
    listing = (await client.get(
        "/api/v1/activities/", params={"project_id": project.id.__str__(), "schedule_period_id": str(live_schedule_period.id)}
    )).json()
    container = next(x for x in listing if x["is_archive_container"])

    b = await _create(client, project, live_schedule_period, task_name="Piling")
    resp = await client.patch(f"/api/v1/activities/{b['id']}", json={"parent_id": container["id"]})
    assert resp.status_code == 422
