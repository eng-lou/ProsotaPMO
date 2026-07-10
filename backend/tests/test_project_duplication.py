from __future__ import annotations

import uuid
from datetime import date

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.models.project import Project
from app.models.record_link import RecordLink
from app.models.schedule_period import SchedulePeriod
from app.models.scheduling_quality_run import SchedulingQualityRun

_MONDAY = date(2025, 6, 2)


async def _anchor(db: AsyncSession, schedule_period: SchedulePeriod) -> None:
    schedule_period.start_date = _MONDAY
    await db.commit()


async def _build_rich_project(
    client: AsyncClient, db: AsyncSession, project: Project, period: Period, schedule_period: SchedulePeriod
) -> dict:
    """One project touching every module a duplicate needs to clone: schedule
    (activities/relationships/resources/calendar with breaks+exceptions/
    baseline/sub-project/quality run+criteria/filter/layout), risk (criteria/
    risk/mitigation action), cost (criteria/element/rate line/commitment),
    ICD (criteria/item/action item/comment), a reassessment on each of
    risk/icd_item/cost_element, and a record link crossing modules."""
    await _anchor(db, schedule_period)

    # Lazily seeds the Standard Calendar as this project's default — activity
    # creation requires one to exist already (see test_scheduling_cpm.py's
    # own convention).
    await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})

    calendar = (await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Night Shift", "day_start_time": "20:00", "day_end_time": "23:00",
    })).json()
    await client.post("/api/v1/calendar-breaks/", json={
        "calendar_id": calendar["id"], "label": "Break", "start_time": "21:00", "end_time": "21:30",
    })
    await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar["id"], "label": "Shutdown", "start_date": "2025-06-04", "end_date": "2025-06-04",
        "is_working": False,
    })

    top_resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(schedule_period.id), "task_name": "Programme",
    })
    assert top_resp.status_code == 201, top_resp.text
    top = top_resp.json()
    branch = (await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(schedule_period.id),
        "task_name": "Enabling Works", "parent_id": top["id"],
    })).json()
    a = (await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(schedule_period.id),
        "task_name": "Task A", "parent_id": branch["id"],
        "duration_hours": 40, "calendar_id": calendar["id"],
    })).json()
    b = (await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(schedule_period.id),
        "task_name": "Task B", "parent_id": branch["id"],
        "duration_hours": 40,
    })).json()
    rel = (await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })).json()

    subproject = (await client.post("/api/v1/schedule-subprojects/", json={
        "project_id": str(project.id), "name": "Enabling Works", "root_wbs_id": branch["id"],
    })).json()

    resource = (await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "45",
    })).json()
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": a["id"], "resource_id": resource["id"], "utilisation_pct": 100,
    })

    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(schedule_period.id), "name": "Contract Baseline", "baseline_date": "2026-01-01",
    })).json()
    await client.post(f"/api/v1/schedule-baselines/{baseline['id']}/assign")

    quality_run = (await client.post("/api/v1/scheduling-quality-runs/", json={
        "schedule_period_id": str(schedule_period.id), "name": "Checkpoint", "scope_subproject_id": subproject["id"],
    })).json()

    criteria_resp = await client.get("/api/v1/scheduling-quality-criteria/", params={"project_id": str(project.id)})
    assert criteria_resp.status_code == 200

    sched_filter = (await client.post("/api/v1/scheduling-filters/", json={
        "project_id": str(project.id), "name": "Critical only", "match_mode": "all",
        "conditions": [{"field": "is_critical", "operator": "is_true", "value": ""}],
    })).json()

    layout = (await client.post("/api/v1/gantt-layouts/", json={
        "project_id": str(project.id), "name": "Client Colours",
    })).json()

    risk = (await client.post("/api/v1/risks/", json={
        "project_id": str(project.id), "period_id": str(period.id), "title": "Supply chain delay",
    })).json()
    await client.post("/api/v1/risk-mitigation-actions/", json={
        "risk_id": risk["id"], "description": "Dual-source supplier",
    })
    await client.post("/api/v1/reassessments/", json={
        "record_type": "risk", "record_id": risk["id"], "note": "Probability revised",
    })

    cost_element = (await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id), "period_id": str(period.id), "description": "Piling", "budget": "100000",
    })).json()
    await client.post("/api/v1/cost-rate-lines/", json={
        "cost_element_id": cost_element["id"], "description": "Piles", "qty": "10", "rate": "500",
    })
    await client.post("/api/v1/cost-commitments/", json={
        "cost_element_id": cost_element["id"], "description": "PO-001", "amount": "5000",
    })
    await client.post("/api/v1/reassessments/", json={
        "record_type": "cost_element", "record_id": cost_element["id"], "note": "Reforecast",
    })

    icd_item = (await client.post("/api/v1/icd-items/", json={
        "project_id": str(project.id), "period_id": str(period.id),
        "item_type": "issue", "title": "Service clash", "severity": "high",
    })).json()
    await client.post("/api/v1/icd-action-items/", json={
        "icd_item_id": icd_item["id"], "description": "Confirm diversion route",
    })
    await client.post("/api/v1/icd-comments/", json={"icd_item_id": icd_item["id"], "body": "Investigating"})
    await client.post("/api/v1/reassessments/", json={
        "record_type": "icd_item", "record_id": icd_item["id"], "note": "Escalated",
    })

    link = (await client.post("/api/v1/record-links/", json={
        "source_type": "activity", "source_id": a["id"], "target_type": "risk", "target_id": risk["id"],
        "link_type": "causes",
    })).json()

    await client.put("/api/v1/letterhead/", json={
        "project_id": str(project.id), "logo_position": "left",
        "header_left": {"text": "Custom Header", "bold": True, "italic": False, "font_size": 12, "align": "left"},
    })

    return {
        "calendar": calendar, "top": top, "branch": branch, "a": a, "b": b, "rel": rel,
        "subproject": subproject, "resource": resource, "baseline": baseline, "quality_run": quality_run,
        "sched_filter": sched_filter, "layout": layout, "risk": risk, "cost_element": cost_element,
        "icd_item": icd_item, "link": link,
    }


async def _duplicate(client: AsyncClient, project_id: str, name: str | None = None) -> dict:
    resp = await client.post(f"/api/v1/projects/{project_id}/duplicate", json={"name": name} if name else {})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_duplicate_creates_independent_project(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    await _build_rich_project(client, db, project, live_period, live_schedule_period)
    copy = await _duplicate(client, str(project.id), "My Copy")
    assert copy["id"] != str(project.id)
    assert copy["name"] == "My Copy"
    assert copy["org_id"] == str(project.org_id)  # tenant-level, not remapped


async def test_duplicate_default_name(client: AsyncClient, project: Project):
    copy = await _duplicate(client, str(project.id))
    assert copy["name"] == f"{project.name} (Copy)"


async def test_duplicate_nonexistent_project_404(client: AsyncClient):
    resp = await client.post(f"/api/v1/projects/{uuid.uuid4()}/duplicate", json={})
    assert resp.status_code == 404


async def test_duplicate_clones_full_activity_hierarchy_and_relationships(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    data = await _build_rich_project(client, db, project, live_period, live_schedule_period)
    copy = await _duplicate(client, str(project.id))

    new_schedule_period_id = await _new_schedule_period_id(client, copy["id"])
    new_activities = (await client.get("/api/v1/activities/", params={
        "project_id": copy["id"], "schedule_period_id": new_schedule_period_id,
    })).json()
    assert len(new_activities) == 4  # top, branch, a, b
    original_ids = {data["top"]["id"], data["branch"]["id"], data["a"]["id"], data["b"]["id"]}
    new_ids = {a["id"] for a in new_activities}
    assert new_ids.isdisjoint(original_ids)  # genuinely new rows, not shared

    new_branch = next(a for a in new_activities if a["task_name"] == "Enabling Works")
    new_top = next(a for a in new_activities if a["task_name"] == "Programme")
    new_a = next(a for a in new_activities if a["task_name"] == "Task A")
    new_b = next(a for a in new_activities if a["task_name"] == "Task B")
    assert new_branch["parent_id"] == new_top["id"]  # remapped, not the original top's id
    assert new_a["parent_id"] == new_branch["id"]

    new_relationships = (await client.get(
        "/api/v1/activity-relationships/", params={"schedule_period_id": new_schedule_period_id}
    )).json()
    assert len(new_relationships) == 1
    assert new_relationships[0]["predecessor_id"] == new_a["id"]
    assert new_relationships[0]["successor_id"] == new_b["id"]


async def _new_period_id(client: AsyncClient, new_project_id: str) -> str:
    periods = (await client.get("/api/v1/periods/", params={"project_id": new_project_id})).json()
    assert len(periods) == 1
    return periods[0]["id"]


async def _new_schedule_period_id(client: AsyncClient, new_project_id: str) -> str:
    variants = (await client.get("/api/v1/schedule-variants/", params={"project_id": new_project_id})).json()
    master = next(v for v in variants if v["is_master"])
    periods = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": master["id"]}
    )).json()
    assert len(periods) == 1
    return periods[0]["id"]


async def test_duplicate_clones_resources_calendars_subproject_and_saved_config(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    await _build_rich_project(client, db, project, live_period, live_schedule_period)
    copy = await _duplicate(client, str(project.id))

    calendars = (await client.get("/api/v1/calendars/", params={"project_id": copy["id"]})).json()
    non_default = next(c for c in calendars if c["name"] == "Night Shift")
    breaks = (await client.get("/api/v1/calendar-breaks/", params={"calendar_id": non_default["id"]})).json()
    exceptions = (await client.get("/api/v1/calendar-exceptions/", params={"calendar_id": non_default["id"]})).json()
    assert len(breaks) == 1
    assert len(exceptions) == 1

    resources = (await client.get("/api/v1/resources/", params={"project_id": copy["id"]})).json()
    assert len(resources) == 1

    subprojects = (await client.get("/api/v1/schedule-subprojects/", params={"project_id": copy["id"]})).json()
    assert len(subprojects) == 1

    filters = (await client.get("/api/v1/scheduling-filters/", params={"project_id": copy["id"]})).json()
    assert len(filters) == 1

    layouts = (await client.get("/api/v1/gantt-layouts/", params={"project_id": copy["id"]})).json()
    assert len(layouts) == 1


async def test_duplicate_rewrites_embedded_ids_in_jsonb(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """GanttLayout.letterhead_snapshot and SchedulingQualityRun.report both
    embed another row's id as a raw JSONB value, not a real FK — must be
    rewritten to the new project's own ids, not left pointing at the original."""
    data = await _build_rich_project(client, db, project, live_period, live_schedule_period)
    copy = await _duplicate(client, str(project.id))
    new_schedule_period_id = await _new_schedule_period_id(client, copy["id"])

    layouts = (await client.get("/api/v1/gantt-layouts/", params={"project_id": copy["id"]})).json()
    assert layouts[0]["style"] is not None  # sanity: layout itself cloned

    new_subprojects = (await client.get("/api/v1/schedule-subprojects/", params={"project_id": copy["id"]})).json()
    new_subproject_id = new_subprojects[0]["id"]
    assert new_subproject_id != data["subproject"]["id"]

    quality_run_resp = await db.execute(
        select(SchedulingQualityRun).where(SchedulingQualityRun.schedule_period_id == uuid.UUID(new_schedule_period_id))
    )
    new_run = quality_run_resp.scalar_one()
    assert new_run.report["schedule_period_id"] == new_schedule_period_id
    assert new_run.report["scope_subproject_id"] == new_subproject_id
    assert new_run.scope_subproject_id == uuid.UUID(new_subproject_id)


async def test_duplicate_remaps_reassessments_and_record_links(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    data = await _build_rich_project(client, db, project, live_period, live_schedule_period)
    copy = await _duplicate(client, str(project.id))

    new_risks = (await client.get("/api/v1/risks/", params={"project_id": copy["id"]})).json()
    new_risk = new_risks[0]
    assert new_risk["id"] != data["risk"]["id"]

    reassessments = (await client.get("/api/v1/reassessments/", params={
        "record_type": "risk", "record_id": new_risk["id"],
    })).json()
    assert len(reassessments) == 1
    assert reassessments[0]["note"] == "Probability revised"

    # Original risk's own reassessment must be untouched (still exactly one).
    original_reassessments = (await client.get("/api/v1/reassessments/", params={
        "record_type": "risk", "record_id": data["risk"]["id"],
    })).json()
    assert len(original_reassessments) == 1

    new_schedule_period_id = await _new_schedule_period_id(client, copy["id"])
    new_activities = (await client.get("/api/v1/activities/", params={
        "project_id": copy["id"], "schedule_period_id": new_schedule_period_id,
    })).json()
    new_a = next(a for a in new_activities if a["task_name"] == "Task A")

    links_result = await db.execute(
        select(RecordLink).where(RecordLink.source_type == "activity", RecordLink.source_id == uuid.UUID(new_a["id"]))
    )
    new_link = links_result.scalar_one()
    assert new_link.target_type == "risk"
    assert new_link.target_id == uuid.UUID(new_risk["id"])
    assert new_link.source_id != uuid.UUID(data["a"]["id"])
    assert new_link.target_id != uuid.UUID(data["risk"]["id"])


async def test_duplicate_preserves_author_and_creator_tenant_ids(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """IcdComment.author_id and RecordLink.created_by point at Users, which are
    tenant-level, shared across every project in the org — must be copied
    as-is, never remapped."""
    data = await _build_rich_project(client, db, project, live_period, live_schedule_period)
    copy = await _duplicate(client, str(project.id))

    new_icd_items = (await client.get("/api/v1/icd-items/", params={"project_id": copy["id"]})).json()
    new_item = new_icd_items[0]
    original_comments = (await client.get("/api/v1/icd-comments/", params={"icd_item_id": data["icd_item"]["id"]})).json()
    new_comments = (await client.get("/api/v1/icd-comments/", params={"icd_item_id": new_item["id"]})).json()
    assert len(new_comments) == 1
    assert new_comments[0]["author_id"] == original_comments[0]["author_id"]


async def test_duplicate_is_fully_isolated_from_original(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """Editing the copy must never touch the original — the whole point of a
    duplicate being a real, independent copy, not a shared-reference view."""
    data = await _build_rich_project(client, db, project, live_period, live_schedule_period)
    copy = await _duplicate(client, str(project.id))

    new_schedule_period_id = await _new_schedule_period_id(client, copy["id"])
    new_activities = (await client.get("/api/v1/activities/", params={
        "project_id": copy["id"], "schedule_period_id": new_schedule_period_id,
    })).json()
    new_a = next(a for a in new_activities if a["task_name"] == "Task A")

    rename_resp = await client.patch(f"/api/v1/activities/{new_a['id']}", json={"task_name": "Renamed In Copy"})
    assert rename_resp.status_code == 200

    original_a = (await client.get(f"/api/v1/activities/{data['a']['id']}")).json()
    assert original_a["task_name"] == "Task A"  # untouched by the edit above

    del_resp = await client.delete(f"/api/v1/projects/{copy['id']}")
    assert del_resp.status_code == 204
    still_there = (await client.get(f"/api/v1/activities/{data['a']['id']}")).json()
    assert still_there["task_name"] == "Task A"  # deleting the copy didn't cascade into the original
