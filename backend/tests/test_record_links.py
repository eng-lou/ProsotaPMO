from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.period import Period
from app.models.schedule_period import SchedulePeriod
from app.models.project import Project


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _make_activity(client: AsyncClient, project: Project, period: SchedulePeriod, name: str) -> str:
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id),
        "schedule_period_id": str(period.id),
        "task_name": name,
    })
    assert resp.status_code == 201
    return resp.json()["id"]


async def _make_risk(client: AsyncClient, project: Project, period: Period, title: str) -> str:
    resp = await client.post("/api/v1/risks/", json={
        "project_id": str(project.id),
        "period_id": str(period.id),
        "title": title,
    })
    assert resp.status_code == 201
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# Core end-to-end proof: activity ↔ risk link queryable from both sides
# ---------------------------------------------------------------------------

async def test_activity_risk_link_queryable_from_both_sides(
    client: AsyncClient, project: Project, live_period: Period
, live_schedule_period: SchedulePeriod):
    activity_id = await _make_activity(client, project, live_schedule_period, "Excavation works")
    risk_id = await _make_risk(client, project, live_period, "Ground stability risk")

    # Create the typed link: activity causes risk
    link_resp = await client.post("/api/v1/record-links/", json={
        "source_type": "activity",
        "source_id": activity_id,
        "target_type": "risk",
        "target_id": risk_id,
        "link_type": "causes",
        "note": "Deep excavation may destabilise adjacent ground",
    })
    assert link_resp.status_code == 201
    link = link_resp.json()
    assert link["link_type"] == "causes"
    assert link["source_type"] == "activity"
    assert link["target_type"] == "risk"
    link_id = link["id"]

    # Query from the activity side — link appears
    from_activity = await client.get("/api/v1/record-links/", params={
        "record_type": "activity",
        "record_id": activity_id,
    })
    assert from_activity.status_code == 200
    activity_links = from_activity.json()
    assert len(activity_links) == 1
    assert activity_links[0]["id"] == link_id
    assert activity_links[0]["target_type"] == "risk"
    assert activity_links[0]["target_id"] == risk_id

    # Query from the risk side — same link appears
    from_risk = await client.get("/api/v1/record-links/", params={
        "record_type": "risk",
        "record_id": risk_id,
    })
    assert from_risk.status_code == 200
    risk_links = from_risk.json()
    assert len(risk_links) == 1
    assert risk_links[0]["id"] == link_id          # same link object
    assert risk_links[0]["source_type"] == "activity"
    assert risk_links[0]["source_id"] == activity_id

    # The note survives the round-trip
    assert risk_links[0]["note"] == "Deep excavation may destabilise adjacent ground"


# ---------------------------------------------------------------------------
# Multiple links on one record
# ---------------------------------------------------------------------------

async def test_record_can_have_multiple_links(
    client: AsyncClient, project: Project, live_period: Period
, live_schedule_period: SchedulePeriod):
    activity_id = await _make_activity(client, project, live_schedule_period, "Piling works")
    risk_a = await _make_risk(client, project, live_period, "Vibration risk")
    risk_b = await _make_risk(client, project, live_period, "Noise risk")

    for risk_id, link_type in [(risk_a, "causes"), (risk_b, "impacts")]:
        resp = await client.post("/api/v1/record-links/", json={
            "source_type": "activity",
            "source_id": activity_id,
            "target_type": "risk",
            "target_id": risk_id,
            "link_type": link_type,
        })
        assert resp.status_code == 201

    links = (await client.get("/api/v1/record-links/", params={
        "record_type": "activity",
        "record_id": activity_id,
    })).json()
    assert len(links) == 2
    link_types = {l["link_type"] for l in links}
    assert link_types == {"causes", "impacts"}


# ---------------------------------------------------------------------------
# Bidirectionality: links created in either direction appear on both sides
# ---------------------------------------------------------------------------

async def test_link_created_as_target_appears_in_source_query(
    client: AsyncClient, project: Project, live_period: Period
, live_schedule_period: SchedulePeriod):
    activity_id = await _make_activity(client, project, live_schedule_period, "Steel erection")
    risk_id = await _make_risk(client, project, live_period, "Working at height")

    # Link created with risk as source this time
    await client.post("/api/v1/record-links/", json={
        "source_type": "risk",
        "source_id": risk_id,
        "target_type": "activity",
        "target_id": activity_id,
        "link_type": "relates_to",
    })

    # Should still appear when querying from the activity side
    from_activity = (await client.get("/api/v1/record-links/", params={
        "record_type": "activity",
        "record_id": activity_id,
    })).json()
    assert len(from_activity) == 1
    assert from_activity[0]["source_type"] == "risk"


# ---------------------------------------------------------------------------
# Get by ID, delete
# ---------------------------------------------------------------------------

async def test_get_link_by_id(client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod):
    activity_id = await _make_activity(client, project, live_schedule_period, "Formwork")
    risk_id = await _make_risk(client, project, live_period, "Collapse risk")

    created = (await client.post("/api/v1/record-links/", json={
        "source_type": "activity",
        "source_id": activity_id,
        "target_type": "risk",
        "target_id": risk_id,
        "link_type": "mitigates",
    })).json()

    resp = await client.get(f"/api/v1/record-links/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]


async def test_get_link_not_found(client: AsyncClient):
    resp = await client.get(f"/api/v1/record-links/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_delete_link(client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod):
    activity_id = await _make_activity(client, project, live_schedule_period, "Cladding")
    risk_id = await _make_risk(client, project, live_period, "Weather risk")

    created = (await client.post("/api/v1/record-links/", json={
        "source_type": "activity",
        "source_id": activity_id,
        "target_type": "risk",
        "target_id": risk_id,
        "link_type": "relates_to",
    })).json()

    del_resp = await client.delete(f"/api/v1/record-links/{created['id']}")
    assert del_resp.status_code == 204

    # Confirm gone from both sides
    assert (await client.get("/api/v1/record-links/", params={
        "record_type": "activity", "record_id": activity_id,
    })).json() == []

    assert (await client.get("/api/v1/record-links/", params={
        "record_type": "risk", "record_id": risk_id,
    })).json() == []


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

async def test_invalid_link_type_rejected(client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod):
    activity_id = await _make_activity(client, project, live_schedule_period, "Activity X")
    risk_id = await _make_risk(client, project, live_period, "Risk X")

    resp = await client.post("/api/v1/record-links/", json={
        "source_type": "activity",
        "source_id": activity_id,
        "target_type": "risk",
        "target_id": risk_id,
        "link_type": "invented_type",
    })
    assert resp.status_code == 422


async def test_invalid_record_type_rejected(client: AsyncClient):
    resp = await client.post("/api/v1/record-links/", json={
        "source_type": "not_a_real_type",
        "source_id": str(uuid.uuid4()),
        "target_type": "risk",
        "target_id": str(uuid.uuid4()),
        "link_type": "causes",
    })
    assert resp.status_code == 422


async def test_self_link_rejected(client: AsyncClient, project: Project, live_period: Period, live_schedule_period: SchedulePeriod):
    activity_id = await _make_activity(client, project, live_schedule_period, "Self-referencing activity")

    resp = await client.post("/api/v1/record-links/", json={
        "source_type": "activity",
        "source_id": activity_id,
        "target_type": "activity",
        "target_id": activity_id,
        "link_type": "relates_to",
    })
    assert resp.status_code == 422
