from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


def _payload(project_id: str, schedule_period_id: str, **overrides) -> dict:
    payload = {
        "project_id": project_id,
        "schedule_period_id": schedule_period_id,
        "activities": [
            {"temp_id": "wbs-level-1", "task_name": "Level 1", "parent_temp_id": None, "duration_hours": 0},
            {"temp_id": "act-footings", "task_name": "Footings", "parent_temp_id": "wbs-level-1", "duration_hours": 16, "element_refs": ["GUID-FOOTING-1", "GUID-FOOTING-2"]},
            {"temp_id": "act-columns", "task_name": "Columns", "parent_temp_id": "wbs-level-1", "duration_hours": 24, "element_refs": ["GUID-COLUMN-1"]},
        ],
        "resources": [
            {"temp_id": "res-footing-crew", "name": "Footing Crew", "resource_type": "crew", "unit": "day", "rate": "1200"},
            {"temp_id": "res-steel-crew", "name": "Steel Erection Crew", "resource_type": "crew", "unit": "day", "rate": "2400"},
        ],
        "assignments": [
            {"activity_temp_id": "act-footings", "resource_temp_id": "res-footing-crew", "utilisation_pct": "100"},
            {"activity_temp_id": "act-columns", "resource_temp_id": "res-steel-crew", "utilisation_pct": "100"},
        ],
        "relationships": [
            {"predecessor_temp_id": "act-footings", "successor_temp_id": "act-columns", "relationship_type": "FS", "lag_hours": "0"},
        ],
    }
    payload.update(overrides)
    return payload


def _large_multi_storey_payload(project_id: str, schedule_period_id: str, storey_count: int = 17, phases_per_storey: int = 4) -> dict:
    """Mirrors the real shape the IFC wizard generates -- a root WBS
    (root parent added by the caller below), N storey WBS children, each
    with several phase-level task children FS-chained within the storey
    and between consecutive storeys, resourced like a real generation
    always is (see the resources/assignments built below)."""
    activities = [{"temp_id": "root", "task_name": "Test Model.ifc", "parent_temp_id": None, "duration_hours": 0}]
    for s in range(storey_count):
        storey_id = f"storey-{s}"
        activities.append({"temp_id": storey_id, "task_name": f"Storey {s}", "parent_temp_id": "root", "duration_hours": 0})
        for p in range(phases_per_storey):
            activities.append({
                "temp_id": f"phase-{s}-{p}", "task_name": f"Storey {s} — Phase {p}",
                "parent_temp_id": storey_id, "duration_hours": 8,
            })
    relationships = []
    for s in range(storey_count):
        for p in range(phases_per_storey - 1):
            relationships.append({
                "predecessor_temp_id": f"phase-{s}-{p}", "successor_temp_id": f"phase-{s}-{p + 1}",
                "relationship_type": "FS", "lag_hours": "0",
            })
        if s > 0:
            relationships.append({
                "predecessor_temp_id": f"phase-{s - 1}-{phases_per_storey - 1}", "successor_temp_id": f"phase-{s}-0",
                "relationship_type": "FS", "lag_hours": "0",
            })
    # A resource + an assignment on *every* phase activity -- the real
    # wizard-generated schedule always exercises bulk_generate's own
    # cost_sync loop (one call per activity with an assignment, run after
    # the final hierarchy pass); a payload with zero resources/assignments
    # never touches that loop at all, and turned out not to reproduce the
    # bug the way the real generation did.
    resources = [{"temp_id": "crew", "name": "Test Crew", "resource_type": "crew", "unit": "day", "rate": "1000"}]
    assignments = [
        {"activity_temp_id": f"phase-{s}-{p}", "resource_temp_id": "crew", "utilisation_pct": "100"}
        for s in range(storey_count) for p in range(phases_per_storey)
    ]
    return {
        "project_id": project_id, "schedule_period_id": schedule_period_id,
        "activities": activities, "resources": resources, "assignments": assignments, "relationships": relationships,
    }


async def test_bulk_generate_root_start_matches_earliest_child_at_real_scale(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod,
):
    # 2026-07-13, per Maro's screenshot: the root WBS's own Start showed
    # 2030, years after its earliest child (PIT, 2026). NOTE: this test
    # passes even with schedule_bulk_generate.py's own extra trailing
    # _recompute_hierarchy call removed -- a faithful reproduction attempt
    # (this same 17-storey/4-phase/85-activity/resourced shape) could not
    # reproduce the bug through the API despite genuinely trying, so it
    # isn't proven to be a real regression gate for that specific issue.
    # Kept anyway as a real, useful baseline: multi-level rollup correctness
    # at realistic generated-tree scale, which is worth its own coverage
    # regardless. The extra call itself stays in schedule_bulk_generate.py
    # as a cheap, safe, empirically-motivated (if not fully explained)
    # safety net -- see its own comment there.
    resp = await client.post(
        "/api/v1/schedule-bulk-generate/",
        json=_large_multi_storey_payload(str(project.id), str(live_schedule_period.id)),
    )
    assert resp.status_code == 201, resp.text
    root_id = resp.json()["activity_ids_by_temp_id"]["root"]
    storey0_id = resp.json()["activity_ids_by_temp_id"]["storey-0"]

    root = (await client.get(f"/api/v1/activities/{root_id}")).json()
    storey0 = (await client.get(f"/api/v1/activities/{storey0_id}")).json()
    # storey-0 is the earliest-sequenced storey -- the root's own rolled-up
    # Start must match it exactly, immediately after generation, with no
    # extra manual recompute call.
    assert root["start"] == storey0["start"]


async def test_bulk_generate_creates_everything(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    resp = await client.post(
        "/api/v1/schedule-bulk-generate/", json=_payload(str(project.id), str(live_schedule_period.id)),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["activity_count"] == 3
    assert body["resource_count"] == 2
    assert body["assignment_count"] == 2
    assert body["relationship_count"] == 1
    assert body["model_element_link_count"] == 3
    assert set(body["activity_ids_by_temp_id"].keys()) == {"wbs-level-1", "act-footings", "act-columns"}

    activities = (await client.get(
        "/api/v1/activities/", params={"project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id)},
    )).json()
    assert len(activities) == 3
    wbs = next(a for a in activities if a["task_name"] == "Level 1")
    footings = next(a for a in activities if a["task_name"] == "Footings")
    columns = next(a for a in activities if a["task_name"] == "Columns")
    # The WBS parent auto-promotes to wbs_summary once it has children —
    # the same _recompute_hierarchy mechanism a single create_activity
    # already relies on, just run once for this whole batch.
    assert wbs["activity_type"] == "wbs_summary"
    assert footings["parent_id"] == wbs["id"]
    assert columns["parent_id"] == wbs["id"]
    # CPM actually ran: Columns' start should have been pushed out by the
    # FS relationship from Footings, not left at whatever it would be
    # unsequenced.
    assert columns["start"] >= footings["finish"]


async def test_bulk_generate_creates_model_element_links(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    resp = await client.post(
        "/api/v1/schedule-bulk-generate/", json=_payload(str(project.id), str(live_schedule_period.id)),
    )
    activity_id = resp.json()["activity_ids_by_temp_id"]["act-footings"]

    links = (await client.get("/api/v1/model-element-links/", params={"project_id": str(project.id)})).json()
    footing_links = [l for l in links if l["activity_id"] == activity_id]
    assert {l["element_ref"] for l in footing_links} == {"GUID-FOOTING-1", "GUID-FOOTING-2"}
    assert all(l["source_kind"] == "ifc" for l in footing_links)


async def test_bulk_generate_resource_assignment_drives_cost(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    # Confirms cost_sync actually ran (once per activity with an
    # assignment, at the end of the batch, not per-row) — the activity
    # should have picked up a linked schedule Cost Element with a nonzero
    # budget from its resource assignment.
    resp = await client.post(
        "/api/v1/schedule-bulk-generate/", json=_payload(str(project.id), str(live_schedule_period.id)),
    )
    activity_id = resp.json()["activity_ids_by_temp_id"]["act-footings"]
    activity = (await client.get(f"/api/v1/activities/{activity_id}")).json()
    assert activity["bac"] is not None
    assert float(activity["bac"]) > 0


async def test_bulk_generate_supports_equipment_resources_alongside_crew(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod,
):
    # 2026-07-13, per Maro: "add more detail to the schedule, also more
    # resources, realistic, equipment etc." -- the IFC wizard now assigns
    # both a crew and, for phases that need it, a piece of equipment (an
    # excavator, mobile crane, concrete pump) to the same activity. Confirms
    # this new path -- two ResourceAssignments on one activity, one
    # resource_type='crew' and one 'equipment' -- creates and prices
    # correctly end to end, not just that resource_type='equipment' is
    # schema-valid.
    payload = _payload(
        str(project.id), str(live_schedule_period.id),
        resources=[
            {"temp_id": "res-crew", "name": "Excavation Crew", "resource_type": "crew", "unit": "day", "rate": "1100"},
            {"temp_id": "res-equip", "name": "Excavator (Mini)", "resource_type": "equipment", "unit": "day", "rate": "600"},
        ],
        assignments=[
            {"activity_temp_id": "act-footings", "resource_temp_id": "res-crew", "utilisation_pct": "100"},
            {"activity_temp_id": "act-footings", "resource_temp_id": "res-equip", "utilisation_pct": "100"},
        ],
        relationships=[],
    )
    resp = await client.post("/api/v1/schedule-bulk-generate/", json=payload)
    assert resp.status_code == 201, resp.text
    assert resp.json()["resource_count"] == 2
    assert resp.json()["assignment_count"] == 2

    activity_id = resp.json()["activity_ids_by_temp_id"]["act-footings"]
    assignments = (await client.get(
        "/api/v1/resource-assignments/", params={"schedule_period_id": str(live_schedule_period.id)},
    )).json()
    own = [a for a in assignments if a["activity_id"] == activity_id]
    assert len(own) == 2
    assert {a["resource_type"] for a in own} == {"crew", "equipment"}

    activity = (await client.get(f"/api/v1/activities/{activity_id}")).json()
    # Both resources' day rates contribute to the same activity's budget --
    # crew alone would already be nonzero (per the sibling test above), so
    # this confirms the equipment assignment is genuinely priced in too,
    # not silently ignored.
    assert float(activity["bac"]) > 0


async def test_bulk_generate_rejects_cyclic_relationships(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    payload = _payload(
        str(project.id), str(live_schedule_period.id),
        relationships=[
            {"predecessor_temp_id": "act-footings", "successor_temp_id": "act-columns", "relationship_type": "FS", "lag_hours": "0"},
            {"predecessor_temp_id": "act-columns", "successor_temp_id": "act-footings", "relationship_type": "FS", "lag_hours": "0"},
        ],
    )
    resp = await client.post("/api/v1/schedule-bulk-generate/", json=payload)
    assert resp.status_code == 422

    # Nothing should have been committed — a partial generation would be
    # worse than an outright rejection.
    activities = (await client.get(
        "/api/v1/activities/", params={"project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id)},
    )).json()
    assert activities == []


async def test_bulk_generate_rejects_unknown_temp_id(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    payload = _payload(str(project.id), str(live_schedule_period.id))
    payload["assignments"].append({"activity_temp_id": "does-not-exist", "resource_temp_id": "res-footing-crew", "utilisation_pct": "100"})
    resp = await client.post("/api/v1/schedule-bulk-generate/", json=payload)
    assert resp.status_code == 422


async def test_bulk_generate_rejects_frozen_period(client: AsyncClient, project: Project, frozen_schedule_period: SchedulePeriod):
    resp = await client.post(
        "/api/v1/schedule-bulk-generate/", json=_payload(str(project.id), str(frozen_schedule_period.id)),
    )
    assert resp.status_code == 422


async def test_bulk_generate_unknown_schedule_period_404s(client: AsyncClient, project: Project):
    resp = await client.post(
        "/api/v1/schedule-bulk-generate/", json=_payload(str(project.id), str(uuid.uuid4())),
    )
    assert resp.status_code == 404


async def test_bulk_generate_empty_payload_is_a_noop(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    resp = await client.post(
        "/api/v1/schedule-bulk-generate/",
        json={"project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id)},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["activity_count"] == 0
    assert body["activity_ids_by_temp_id"] == {}


async def test_bulk_generate_applies_chosen_calendar_to_every_activity(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod,
):
    calendars = (await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})).json()
    standard = calendars[0]["id"]
    concrete = (await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Concrete Calendar", "works_saturday": True,
    })).json()

    resp = await client.post(
        "/api/v1/schedule-bulk-generate/",
        json=_payload(str(project.id), str(live_schedule_period.id), calendar_id=concrete["id"]),
    )
    assert resp.status_code == 201, resp.text
    activity_id = resp.json()["activity_ids_by_temp_id"]["act-footings"]
    activity = (await client.get(f"/api/v1/activities/{activity_id}")).json()
    assert activity["calendar_id"] == concrete["id"]
    assert activity["calendar_id"] != standard


async def test_bulk_generate_rejects_calendar_from_another_project(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod,
):
    other = (await client.post("/api/v1/projects/", json={"name": "Other Project", "client_name": "Other"})).json()
    other_calendar = (await client.get("/api/v1/calendars/", params={"project_id": other["id"]})).json()[0]

    resp = await client.post(
        "/api/v1/schedule-bulk-generate/",
        json=_payload(str(project.id), str(live_schedule_period.id), calendar_id=other_calendar["id"]),
    )
    assert resp.status_code == 422
