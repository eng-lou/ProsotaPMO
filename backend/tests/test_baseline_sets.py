from __future__ import annotations

from httpx import AsyncClient

from app.models.organisation import Organisation
from app.models.period import Period
from app.models.project import Project
from app.models.user import User
from app.models.schedule_period import SchedulePeriod


async def _create_risk(client: AsyncClient, project: Project, period: Period, title: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "title": title}
    payload.update(overrides)
    resp = await client.post("/api/v1/risks/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_capture_all_creates_and_links_all_four_module_baselines(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    await _create_risk(client, project, live_period, "Weather delay")

    resp = await client.post("/api/v1/baseline-sets/capture-all", json={
        "project_id": str(project.id), "name": "Contract Baseline", "baseline_date": "2026-07-20",
        "period_id": str(live_period.id), "schedule_period_id": str(live_schedule_period.id),
    })
    assert resp.status_code == 201, resp.text
    baseline_set = resp.json()

    risk_baselines = (await client.get("/api/v1/risk-baselines/", params={"period_id": str(live_period.id)})).json()
    cost_baselines = (await client.get("/api/v1/cost-baselines/", params={"period_id": str(live_period.id)})).json()
    icd_baselines = (await client.get("/api/v1/icd-baselines/", params={"period_id": str(live_period.id)})).json()
    schedule_baselines = (await client.get("/api/v1/schedule-baselines/", params={"schedule_period_id": str(live_schedule_period.id)})).json()

    assert risk_baselines[0]["baseline_set_id"] == baseline_set["id"]
    assert cost_baselines[0]["baseline_set_id"] == baseline_set["id"]
    assert icd_baselines[0]["baseline_set_id"] == baseline_set["id"]
    assert schedule_baselines[0]["baseline_set_id"] == baseline_set["id"]


async def test_manual_link_and_unlink_a_standalone_baseline(
    client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod
):
    # A BaselineSet is only ever born via capture-all (no standalone "create an
    # empty set" endpoint) — manual linking is for moving an *already-existing*
    # standalone module baseline in or out of a set created that way, e.g.
    # "I already baselined Cost last week, just link it into this set now."
    baseline_set = (await client.post("/api/v1/baseline-sets/capture-all", json={
        "project_id": str(project.id), "name": "Contract Baseline", "baseline_date": "2026-07-20",
        "period_id": str(live_period.id), "schedule_period_id": str(live_schedule_period.id),
    })).json()

    standalone = (await client.post("/api/v1/risk-baselines/", json={
        "period_id": str(live_period.id), "name": "Re-baselined later", "baseline_date": "2026-07-25",
    })).json()
    assert standalone["baseline_set_id"] is None

    link_resp = await client.post("/api/v1/baseline-sets/link", json={
        "module": "risk", "baseline_id": standalone["id"], "baseline_set_id": baseline_set["id"],
    })
    assert link_resp.status_code == 204

    risk_baselines = (await client.get("/api/v1/risk-baselines/", params={"period_id": str(live_period.id)})).json()
    linked = next(b for b in risk_baselines if b["id"] == standalone["id"])
    assert linked["baseline_set_id"] == baseline_set["id"]

    unlink_resp = await client.post("/api/v1/baseline-sets/link", json={
        "module": "risk", "baseline_id": standalone["id"], "baseline_set_id": None,
    })
    assert unlink_resp.status_code == 204
    risk_baselines = (await client.get("/api/v1/risk-baselines/", params={"period_id": str(live_period.id)})).json()
    unlinked = next(b for b in risk_baselines if b["id"] == standalone["id"])
    assert unlinked["baseline_set_id"] is None


async def test_link_rejects_a_set_from_a_different_project(
    client: AsyncClient, db, org: Organisation, project: Project, live_period: Period, user: User
):
    other_project = Project(org_id=org.id, created_by=user.id, name="Other Project", client_name="Other Client")
    db.add(other_project)
    await db.commit()
    await db.refresh(other_project)
    other_period = Period(project_id=other_project.id, period_label="Period 1", freeze_status="live")
    db.add(other_period)
    await db.commit()
    await db.refresh(other_period)

    # A baseline set only ever gets created via capture-all today — build one
    # for the *other* project, then try to link this project's own risk
    # baseline into it.
    other_schedule_variant_resp = await client.post("/api/v1/schedule-variants/bootstrap", params={"project_id": str(other_project.id)})
    other_variant = other_schedule_variant_resp.json()
    other_schedule_period_resp = await client.post("/api/v1/schedule-periods/bootstrap", params={"schedule_variant_id": other_variant["id"]})
    other_schedule_period = other_schedule_period_resp.json()

    other_set = (await client.post("/api/v1/baseline-sets/capture-all", json={
        "project_id": str(other_project.id), "name": "Other Set", "baseline_date": "2026-07-20",
        "period_id": str(other_period.id), "schedule_period_id": str(other_schedule_period["id"]),
    })).json()

    my_baseline = (await client.post("/api/v1/risk-baselines/", json={
        "period_id": str(live_period.id), "name": "My baseline", "baseline_date": "2026-07-20",
    })).json()

    resp = await client.post("/api/v1/baseline-sets/link", json={
        "module": "risk", "baseline_id": my_baseline["id"], "baseline_set_id": other_set["id"],
    })
    assert resp.status_code == 422
