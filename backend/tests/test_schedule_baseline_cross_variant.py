from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organisation import Organisation
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


async def _fork(client: AsyncClient, project: Project, source_variant_id: str, name: str) -> dict:
    resp = await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": name, "duplicate_from_variant_id": source_variant_id,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_baseline_from_variant_uses_sources_current_dates(client: AsyncClient, project: Project):
    """Maro: "the ability to use the second programme and assign the
    original schedule as a baseline is important and vice versa." Baselining
    the master from a forked variant must snapshot *that variant's own
    current* dates, matched by code — not the master's own current state
    (which create_baseline, the same-variant path, already covers)."""
    master = await _bootstrap_master(client, project)
    master_period = await _bootstrap_period(client, master["id"])
    activity = await _create_activity(client, project, master_period, "Piling", duration_hours=40)  # 5 days

    fork = await _fork(client, project, master["id"], "Recovery Schedule")
    fork_period = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": fork["id"]}
    )).json()[0]
    fork_activity = (await _list_activities(client, project, fork_period))[0]
    assert fork_activity["code"] == activity["code"]

    # Diverge the fork from the master — this is "the second programme"
    # having moved on independently.
    resp = await client.patch(f"/api/v1/activities/{fork_activity['id']}", json={"duration_hours": 80})
    assert resp.status_code == 200
    fork_activity = resp.json()

    baseline_resp = await client.post("/api/v1/schedule-baselines/from-variant", json={
        "schedule_period_id": master_period["id"], "source_schedule_variant_id": fork["id"],
        "name": "Recovery Baseline", "baseline_date": "2026-01-01",
    })
    assert baseline_resp.status_code == 201, baseline_resp.text
    baseline = baseline_resp.json()
    assert baseline["activity_count"] == 1

    snapshot = (await client.get(f"/api/v1/schedule-baselines/{baseline['id']}/snapshot")).json()
    assert len(snapshot) == 1
    snap = snapshot[0]
    assert snap["activity_id"] == activity["id"]  # keyed to the TARGET's own activity
    assert snap["code"] == activity["code"]
    # ...but the captured values are the SOURCE (fork)'s current state, not
    # the master's own (still-40h) current state.
    assert float(snap["duration_hours"]) == 80.0
    assert snap["finish"] == fork_activity["finish"]
    assert snap["finish"] != activity["finish"]


async def test_baseline_from_variant_skips_unmatched_codes(client: AsyncClient, project: Project):
    master = await _bootstrap_master(client, project)
    master_period = await _bootstrap_period(client, master["id"])
    await _create_activity(client, project, master_period, "Piling", duration_hours=40)

    fork = await _fork(client, project, master["id"], "Recovery Schedule")

    # Added to the master *after* forking — no matching code exists on the fork.
    orphan = await _create_activity(client, project, master_period, "Late addition", duration_hours=8)

    baseline_resp = await client.post("/api/v1/schedule-baselines/from-variant", json={
        "schedule_period_id": master_period["id"], "source_schedule_variant_id": fork["id"],
        "name": "Recovery Baseline", "baseline_date": "2026-01-01",
    })
    assert baseline_resp.status_code == 201
    baseline = baseline_resp.json()
    assert baseline["activity_count"] == 1  # only "Piling" matched, not the orphan

    snapshot = (await client.get(f"/api/v1/schedule-baselines/{baseline['id']}/snapshot")).json()
    assert all(s["activity_id"] != orphan["id"] for s in snapshot)


async def test_baseline_from_variant_rejects_variant_from_another_project(
    client: AsyncClient, db: AsyncSession, project: Project, org: Organisation,
):
    master = await _bootstrap_master(client, project)
    master_period = await _bootstrap_period(client, master["id"])
    await _create_activity(client, project, master_period, "Piling", duration_hours=40)

    other_project = Project(org_id=org.id, name="Other Project")
    db.add(other_project)
    await db.commit()
    await db.refresh(other_project)
    other_master = await _bootstrap_master(client, other_project)

    resp = await client.post("/api/v1/schedule-baselines/from-variant", json={
        "schedule_period_id": master_period["id"], "source_schedule_variant_id": other_master["id"],
        "name": "Cross-tenant Baseline", "baseline_date": "2026-01-01",
    })
    assert resp.status_code == 404


async def test_baseline_from_variant_rejects_unknown_source_variant(client: AsyncClient, project: Project):
    master = await _bootstrap_master(client, project)
    master_period = await _bootstrap_period(client, master["id"])

    resp = await client.post("/api/v1/schedule-baselines/from-variant", json={
        "schedule_period_id": master_period["id"],
        "source_schedule_variant_id": "00000000-0000-0000-0000-000000000000",
        "name": "X", "baseline_date": "2026-01-01",
    })
    assert resp.status_code == 404


async def test_baseline_from_variant_reverse_direction(client: AsyncClient, project: Project):
    """"...and vice versa" — baselining the fork FROM the master's own
    current state works the same way, just with target/source swapped."""
    master = await _bootstrap_master(client, project)
    master_period = await _bootstrap_period(client, master["id"])
    await _create_activity(client, project, master_period, "Piling", duration_hours=40)

    fork = await _fork(client, project, master["id"], "Recovery Schedule")
    fork_period = (await client.get(
        "/api/v1/schedule-periods/", params={"schedule_variant_id": fork["id"]}
    )).json()[0]

    baseline_resp = await client.post("/api/v1/schedule-baselines/from-variant", json={
        "schedule_period_id": fork_period["id"], "source_schedule_variant_id": master["id"],
        "name": "Working Schedule Baseline", "baseline_date": "2026-01-01",
    })
    assert baseline_resp.status_code == 201, baseline_resp.text
    assert baseline_resp.json()["activity_count"] == 1
