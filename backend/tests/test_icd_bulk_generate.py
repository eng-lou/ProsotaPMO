from __future__ import annotations

from httpx import AsyncClient

from app.models.period import Period
from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _links_for(client: AsyncClient, record_type: str, record_id: str) -> list[dict]:
    resp = await client.get("/api/v1/record-links/", params={"record_type": record_type, "record_id": record_id})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _generate(client: AsyncClient, project: Project, period: Period, items: list[dict]) -> dict:
    resp = await client.post("/api/v1/icd-bulk-generate/", json={
        "project_id": str(project.id), "period_id": str(period.id), "items": items,
    })
    assert resp.status_code == 200, resp.text
    return resp.json()


def _decision(title: str, required_by: str, activity_ids: list[str]) -> dict:
    return {"item_type": "decision", "title": title, "required_by": required_by, "linked_activity_ids": activity_ids}


async def test_first_run_creates_decision_with_links(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Facade Package")

    result = await _generate(client, project, live_period, [_decision("Confirm Facade System", "2026-08-01", [a["id"]])])
    assert result["created_count"] == 1
    assert result["updated_count"] == 0

    items = (await client.get("/api/v1/icd-items/", params={"project_id": str(project.id), "period_id": str(live_period.id)})).json()
    decision = next(i for i in items if i["title"] == "Confirm Facade System")
    assert decision["item_type"] == "decision"
    assert decision["code"].startswith("DEC-")
    assert decision["required_by"] == "2026-08-01"

    links = await _links_for(client, "decision", decision["id"])
    assert len(links) == 1
    assert links[0]["target_id"] == a["id"]
    assert links[0]["link_type"] == "impacts"


async def test_rerun_with_no_changes_is_a_no_op(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Facade Package")
    decision_payload = [_decision("Confirm Facade System", "2026-08-01", [a["id"]])]

    await _generate(client, project, live_period, decision_payload)
    result = await _generate(client, project, live_period, decision_payload)

    assert result["created_count"] == 0
    assert result["updated_count"] == 0  # nothing actually changed — a true no-op, not a forced touch

    items = (await client.get("/api/v1/icd-items/", params={"project_id": str(project.id), "period_id": str(live_period.id)})).json()
    matching = [i for i in items if i["title"] == "Confirm Facade System"]
    assert len(matching) == 1  # not duplicated


async def test_rescan_refreshes_only_the_shifted_discipline(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    facade_activity = await _create_activity(client, project, live_schedule_period, "Facade Package")
    hvac_activity = await _create_activity(client, project, live_schedule_period, "HVAC Package")

    await _generate(client, project, live_period, [
        _decision("Confirm Facade System", "2026-08-01", [facade_activity["id"]]),
        _decision("Confirm HVAC Strategy", "2026-09-01", [hvac_activity["id"]]),
    ])

    # Facade's own schedule slipped two weeks — HVAC is untouched.
    result = await _generate(client, project, live_period, [
        _decision("Confirm Facade System", "2026-08-15", [facade_activity["id"]]),
        _decision("Confirm HVAC Strategy", "2026-09-01", [hvac_activity["id"]]),
    ])
    assert result["created_count"] == 0
    assert result["updated_count"] == 1  # only Facade's decision actually changed

    items = (await client.get("/api/v1/icd-items/", params={"project_id": str(project.id), "period_id": str(live_period.id)})).json()
    facade_decision = next(i for i in items if i["title"] == "Confirm Facade System")
    hvac_decision = next(i for i in items if i["title"] == "Confirm HVAC Strategy")
    assert facade_decision["required_by"] == "2026-08-15"
    assert hvac_decision["required_by"] == "2026-09-01"


async def test_rescan_reconciles_links_when_activity_set_changes(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    old_activity = await _create_activity(client, project, live_schedule_period, "Facade Package A")
    new_activity = await _create_activity(client, project, live_schedule_period, "Facade Package B")

    await _generate(client, project, live_period, [_decision("Confirm Facade System", "2026-08-01", [old_activity["id"]])])
    items = (await client.get("/api/v1/icd-items/", params={"project_id": str(project.id), "period_id": str(live_period.id)})).json()
    decision_id = next(i for i in items if i["title"] == "Confirm Facade System")["id"]

    # The discipline's activity set changed (old one archived/replaced, new one added).
    await _generate(client, project, live_period, [_decision("Confirm Facade System", "2026-08-01", [new_activity["id"]])])

    links = await _links_for(client, "decision", decision_id)
    assert len(links) == 1
    assert links[0]["target_id"] == new_activity["id"]


async def test_rescan_never_touches_a_human_edited_status(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Facade Package")
    await _generate(client, project, live_period, [_decision("Confirm Facade System", "2026-08-01", [a["id"]])])
    items = (await client.get("/api/v1/icd-items/", params={"project_id": str(project.id), "period_id": str(live_period.id)})).json()
    decision = next(i for i in items if i["title"] == "Confirm Facade System")

    await client.patch(f"/api/v1/icd-items/{decision['id']}", json={"status": "closed", "decision_maker": "Jane Doe"})

    await _generate(client, project, live_period, [_decision("Confirm Facade System", "2026-08-15", [a["id"]])])

    refreshed = (await client.get(f"/api/v1/icd-items/{decision['id']}")).json()
    assert refreshed["status"] == "closed"
    assert refreshed["decision_maker"] == "Jane Doe"
    assert refreshed["required_by"] == "2026-08-15"  # the schedule-derived field still refreshes


async def test_issue_and_change_watch_flags_have_no_required_by_and_link_correctly(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    a = await _create_activity(client, project, live_schedule_period, "Structural Package")

    result = await _generate(client, project, live_period, [
        {"item_type": "issue", "title": "Watch: Structures — Coordination Risk", "linked_activity_ids": [a["id"]]},
        {"item_type": "change", "title": "Watch: Structures — Anticipated Variation", "linked_activity_ids": [a["id"]]},
    ])
    assert result["created_count"] == 2

    items = (await client.get("/api/v1/icd-items/", params={"project_id": str(project.id), "period_id": str(live_period.id)})).json()
    issue = next(i for i in items if i["title"] == "Watch: Structures — Coordination Risk")
    change = next(i for i in items if i["title"] == "Watch: Structures — Anticipated Variation")
    assert issue["item_type"] == "issue" and issue["code"].startswith("ISS-") and issue["required_by"] is None
    assert change["item_type"] == "change" and change["code"].startswith("CHA-") and change["required_by"] is None

    issue_links = await _links_for(client, "issue", issue["id"])
    change_links = await _links_for(client, "change", change["id"])
    assert [l["target_id"] for l in issue_links] == [a["id"]]
    assert [l["target_id"] for l in change_links] == [a["id"]]


async def test_issue_and_decision_with_the_same_title_do_not_collide(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    """Matching is (project_id, item_type, title), not title alone — an
    Issue and a Decision that happen to share a title are two independent
    rows, not one clobbering the other."""
    a = await _create_activity(client, project, live_schedule_period, "Structural Package")
    result = await _generate(client, project, live_period, [
        {"item_type": "issue", "title": "Confirm Structural System", "linked_activity_ids": [a["id"]]},
        _decision("Confirm Structural System", "2026-08-01", [a["id"]]),
    ])
    assert result["created_count"] == 2

    items = (await client.get("/api/v1/icd-items/", params={"project_id": str(project.id), "period_id": str(live_period.id)})).json()
    matching = [i for i in items if i["title"] == "Confirm Structural System"]
    assert {i["item_type"] for i in matching} == {"issue", "decision"}
