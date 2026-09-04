from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.models.project import Project


async def _bootstrap_master(client: AsyncClient, project: Project) -> dict:
    resp = await client.post("/api/v1/schedule-variants/bootstrap", params={"project_id": str(project.id)})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _bootstrap_period(client: AsyncClient, variant_id: str) -> dict:
    resp = await client.post("/api/v1/schedule-periods/bootstrap", params={"schedule_variant_id": variant_id})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _create_activity(client: AsyncClient, project: Project, period: dict, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": period["id"], "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _list_activities(client: AsyncClient, project: Project, period: dict) -> list[dict]:
    resp = await client.get("/api/v1/activities/", params={
        "project_id": str(project.id), "schedule_period_id": period["id"],
    })
    assert resp.status_code == 200
    return resp.json()


# --- Basic CRUD ---------------------------------------------------------------

async def test_bootstrap_creates_master_once_then_reuses(client: AsyncClient, project: Project):
    first = await _bootstrap_master(client, project)
    assert first["is_master"] is True
    assert first["name"] == "Working Schedule"

    second = await _bootstrap_master(client, project)
    assert second["id"] == first["id"]

    listing = (await client.get("/api/v1/schedule-variants/", params={"project_id": str(project.id)})).json()
    assert len(listing) == 1


async def test_create_blank_variant_gets_its_own_live_period(client: AsyncClient, project: Project):
    await _bootstrap_master(client, project)

    resp = await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": "Recovery Schedule",
    })
    assert resp.status_code == 201, resp.text
    variant = resp.json()
    assert variant["is_master"] is False

    periods = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": variant["id"]}
    )).json()
    assert len(periods) == 1
    assert periods[0]["freeze_status"] == "live"


async def test_update_variant_name_and_type(client: AsyncClient, project: Project):
    master = await _bootstrap_master(client, project)
    resp = await client.patch(f"/api/v1/schedule-variants/{master['id']}", json={
        "name": "Renamed", "variant_type": "Mitigation Schedule",
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"
    assert resp.json()["variant_type"] == "Mitigation Schedule"


async def test_delete_master_variant_rejected(client: AsyncClient, project: Project):
    master = await _bootstrap_master(client, project)
    resp = await client.delete(f"/api/v1/schedule-variants/{master['id']}")
    assert resp.status_code == 422
    assert "master" in resp.json()["detail"].lower()


async def test_delete_non_master_variant_succeeds(client: AsyncClient, project: Project):
    await _bootstrap_master(client, project)
    other = (await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": "Scenario A",
    })).json()

    resp = await client.delete(f"/api/v1/schedule-variants/{other['id']}")
    assert resp.status_code == 204

    listing = (await client.get("/api/v1/schedule-variants/", params={"project_id": str(project.id)})).json()
    assert all(v["id"] != other["id"] for v in listing)


# --- Duplicate (fork) ----------------------------------------------------------

async def test_duplicate_variant_preserves_codes_on_new_ids(client: AsyncClient, project: Project):
    master = await _bootstrap_master(client, project)
    master_period = await _bootstrap_period(client, master["id"])
    top = await _create_activity(client, project, master_period, "Programme")
    await _create_activity(client, project, master_period, "Piling", parent_id=top["id"], duration_hours=8)
    # Gaining a child auto-promotes "Programme" from a plain task to a WBS
    # summary (_recompute_hierarchy), which renumbers its code — re-fetch
    # rather than trust the stale in-memory response from before that happened.
    master_activities = await _list_activities(client, project, master_period)
    top = next(a for a in master_activities if a["task_name"] == "Programme")
    child = next(a for a in master_activities if a["task_name"] == "Piling")

    resp = await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": "Recovery Schedule", "duplicate_from_variant_id": master["id"],
    })
    assert resp.status_code == 201, resp.text
    fork = resp.json()
    assert fork["is_master"] is False

    fork_periods = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": fork["id"]}
    )).json()
    assert len(fork_periods) == 1
    fork_period = fork_periods[0]

    fork_activities = await _list_activities(client, project, fork_period)
    assert len(fork_activities) == 2
    fork_top = next(a for a in fork_activities if a["task_name"] == "Programme")
    fork_child = next(a for a in fork_activities if a["task_name"] == "Piling")

    # Same codes, genuinely new rows.
    assert fork_top["code"] == top["code"]
    assert fork_child["code"] == child["code"]
    assert fork_top["id"] != top["id"]
    assert fork_child["id"] != child["id"]
    # Hierarchy remapped to the fork's own new ids, not the master's.
    assert fork_child["parent_id"] == fork_top["id"]


async def test_duplicate_variant_preserves_relationships(client: AsyncClient, project: Project):
    master = await _bootstrap_master(client, project)
    master_period = await _bootstrap_period(client, master["id"])
    a = await _create_activity(client, project, master_period, "Excavation", duration_hours=8)
    b = await _create_activity(client, project, master_period, "Piling", duration_hours=8)
    await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": a["id"], "successor_id": b["id"],
    })

    fork = (await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": "Recovery Schedule", "duplicate_from_variant_id": master["id"],
    })).json()
    fork_period = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": fork["id"]}
    )).json()[0]

    fork_activities = await _list_activities(client, project, fork_period)
    fork_a = next(x for x in fork_activities if x["task_name"] == "Excavation")
    fork_b = next(x for x in fork_activities if x["task_name"] == "Piling")

    rels = (await client.get(
        "/api/v1/activity-relationships/", params={"schedule_period_id": fork_period["id"]}
    )).json()
    assert len(rels) == 1
    assert rels[0]["predecessor_id"] == fork_a["id"]
    assert rels[0]["successor_id"] == fork_b["id"]


async def test_duplicate_variant_is_independent_of_master(client: AsyncClient, project: Project):
    """Editing the fork must never touch the master it was forked from."""
    master = await _bootstrap_master(client, project)
    master_period = await _bootstrap_period(client, master["id"])
    a = await _create_activity(client, project, master_period, "Excavation")

    fork = (await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": "Recovery Schedule", "duplicate_from_variant_id": master["id"],
    })).json()
    fork_period = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": fork["id"]}
    )).json()[0]
    fork_a = (await _list_activities(client, project, fork_period))[0]

    await client.patch(f"/api/v1/activities/{fork_a['id']}", json={"task_name": "Renamed In Fork"})

    original = (await client.get(f"/api/v1/activities/{a['id']}")).json()
    assert original["task_name"] == "Excavation"


# --- Promotion -------------------------------------------------------------

async def test_promote_flips_master_flag(client: AsyncClient, project: Project):
    master = await _bootstrap_master(client, project)
    other = (await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": "Recovery Schedule",
    })).json()

    resp = await client.post(f"/api/v1/schedule-variants/{other['id']}/promote")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["variant"]["id"] == other["id"]
    assert data["variant"]["is_master"] is True
    assert data["unmatched_codes"] == []

    old_master = (await client.get(f"/api/v1/schedule-variants/{master['id']}")).json()
    assert old_master["is_master"] is False


async def test_promoting_the_current_master_is_a_noop(client: AsyncClient, project: Project):
    master = await _bootstrap_master(client, project)
    resp = await client.post(f"/api/v1/schedule-variants/{master['id']}/promote")
    assert resp.status_code == 200
    data = resp.json()
    assert data["variant"]["id"] == master["id"]
    assert data["variant"]["is_master"] is True
    assert data["unmatched_codes"] == []


async def test_promote_creates_cost_elements_for_never_synced_master(
    client: AsyncClient, project: Project, live_period: Period
):
    """A non-master variant's resource assignments never create real Cost
    Plan lines (sync_cost_element_from_resources's own is_master gate) —
    correct while it's still under review, but nothing ever created them
    retroactively once such a variant actually becomes master (2026-09-04,
    found wiring up the PV/EV/AC trend chart against a real P6 import: 462
    resource assignments promoted to master, 0 cost elements). Unlike
    test_promote_relinks_cost_element_and_record_link_by_code above, there's
    no old master at all here — this is a project's first-ever schedule
    going live, the exact P6-import-then-promote shape."""
    variant = (await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": "Imported: Test Project",
    })).json()
    period = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": variant["id"]}
    )).json()[0]
    activity = await _create_activity(client, project, period, "Piling", duration_hours=40)

    resource = (await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "45",
    })).json()
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })
    cost_elements_before = (await client.get(
        "/api/v1/cost-elements/", params={"project_id": str(project.id), "period_id": str(live_period.id)}
    )).json()
    assert cost_elements_before == []

    resp = await client.post(f"/api/v1/schedule-variants/{variant['id']}/promote")
    assert resp.status_code == 200, resp.text

    cost_elements_after = (await client.get(
        "/api/v1/cost-elements/", params={"project_id": str(project.id), "period_id": str(live_period.id)}
    )).json()
    linked = next((e for e in cost_elements_after if e["source"] == "schedule"), None)
    assert linked is not None
    assert linked["linked_activity_id"] == activity["id"]
    assert float(linked["budget"]) > 0


async def test_promote_relinks_cost_element_and_record_link_by_code(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    master = await _bootstrap_master(client, project)
    master_period = await _bootstrap_period(client, master["id"])
    activity = await _create_activity(client, project, master_period, "Piling", duration_hours=40)

    # Schedule-linked CostElement, created via a resource assignment.
    resource = (await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "45",
    })).json()
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })
    cost_elements = (await client.get(
        "/api/v1/cost-elements/", params={"project_id": str(project.id), "period_id": str(live_period.id)}
    )).json()
    linked_element = next(e for e in cost_elements if e["source"] == "schedule")
    assert linked_element["linked_activity_id"] == activity["id"]

    # A record link crossing modules (activity <-> risk).
    risk = (await client.post("/api/v1/risks/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "title": "Ground risk",
    })).json()
    await client.post("/api/v1/record-links/", json={
        "source_type": "activity", "source_id": activity["id"],
        "target_type": "risk", "target_id": risk["id"], "link_type": "causes",
    })

    fork = (await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": "Recovery Schedule", "duplicate_from_variant_id": master["id"],
    })).json()
    fork_period = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": fork["id"]}
    )).json()[0]
    fork_activity = (await _list_activities(client, project, fork_period))[0]
    assert fork_activity["code"] == activity["code"]

    resp = await client.post(f"/api/v1/schedule-variants/{fork['id']}/promote")
    assert resp.status_code == 200, resp.text
    assert resp.json()["unmatched_codes"] == []

    relinked_element = (await client.get(f"/api/v1/cost-elements/{linked_element['id']}")).json()
    assert relinked_element["linked_activity_id"] == fork_activity["id"]

    links = (await client.get("/api/v1/record-links/", params={
        "record_type": "activity", "record_id": fork_activity["id"],
    })).json()
    assert len(links) == 1
    assert links[0]["target_id"] == risk["id"]


async def test_promote_reports_unmatched_codes_and_clears_dangling_links(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    """An old-master activity with no code match on the new master is exactly
    the case §D.5 covers: SET NULL + a notice, not a silent drop or a hard
    block on the whole promotion."""
    master = await _bootstrap_master(client, project)
    master_period = await _bootstrap_period(client, master["id"])
    fork = (await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": "Recovery Schedule", "duplicate_from_variant_id": master["id"],
    })).json()

    # Added to the master *after* forking — only exists on the old master, so
    # the fork has no matching code for it at all.
    orphan = await _create_activity(client, project, master_period, "Late addition", duration_hours=8)
    resource = (await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "45",
    })).json()
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": orphan["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })
    cost_elements = (await client.get(
        "/api/v1/cost-elements/", params={"project_id": str(project.id), "period_id": str(live_period.id)}
    )).json()
    orphan_element = next(e for e in cost_elements if e["linked_activity_id"] == orphan["id"])

    risk = (await client.post("/api/v1/risks/", json={
        "project_id": str(project.id), "period_id": str(live_period.id), "title": "Ground risk",
    })).json()
    link_resp = await client.post("/api/v1/record-links/", json={
        "source_type": "activity", "source_id": orphan["id"],
        "target_type": "risk", "target_id": risk["id"], "link_type": "causes",
    })
    link_id = link_resp.json()["id"]

    resp = await client.post(f"/api/v1/schedule-variants/{fork['id']}/promote")
    assert resp.status_code == 200, resp.text
    # The orphan's code shows up once per dangling reference it had (one
    # CostElement, one RecordLink) — not deduplicated, since each is a
    # separate broken link a planner needs to know about.
    assert resp.json()["unmatched_codes"] == [orphan["code"], orphan["code"]]

    relinked_element = (await client.get(f"/api/v1/cost-elements/{orphan_element['id']}")).json()
    assert relinked_element["linked_activity_id"] is None

    get_link = await client.get(f"/api/v1/record-links/{link_id}")
    assert get_link.status_code == 404  # dangling link deleted, not left pointing at a foreign variant
