from __future__ import annotations

import uuid
import xml.etree.ElementTree as ET

from httpx import AsyncClient

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _seed_schedule(client: AsyncClient, project: Project, period: SchedulePeriod) -> dict:
    """One WBS summary root with two child tasks (one linked by an FS
    relationship with a lag), a calendar carrying a lunch break and a
    holiday exception, one resource assigned to a task, and one activity
    UDF value — enough real data to exercise every element p6_export_xml.py
    writes."""
    calendar_resp = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Trades Calendar", "is_project_default": True,
        "day_start_time": "08:00:00", "day_end_time": "17:00:00",
        "works_monday": True, "works_tuesday": True, "works_wednesday": True,
        "works_thursday": True, "works_friday": True, "works_saturday": False, "works_sunday": False,
    })
    assert calendar_resp.status_code == 201, calendar_resp.text
    calendar = calendar_resp.json()

    break_resp = await client.post("/api/v1/calendar-breaks/", json={
        "calendar_id": calendar["id"], "label": "Lunch", "start_time": "12:00:00", "end_time": "13:00:00",
    })
    assert break_resp.status_code == 201, break_resp.text

    exception_resp = await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": calendar["id"], "label": "Bank Holiday",
        "start_date": "2026-12-25", "end_date": "2026-12-25", "is_working": False,
    })
    assert exception_resp.status_code == 201, exception_resp.text

    wbs = await _create_activity(client, project, period, "Structure", activity_type="wbs_summary")
    task_a = await _create_activity(
        client, project, period, "Excavate & Prep", parent_id=wbs["id"], duration_hours=32,
        commentary="Watch out for the buried services.",
    )
    task_b = await _create_activity(client, project, period, "Pour Concrete", parent_id=wbs["id"], duration_hours=24)

    rel_resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": task_a["id"], "successor_id": task_b["id"], "relationship_type": "FS", "lag_hours": "8",
    })
    assert rel_resp.status_code == 201, rel_resp.text

    resource_resp = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "450",
    })
    assert resource_resp.status_code == 201, resource_resp.text
    resource = resource_resp.json()

    assignment_resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": task_a["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })
    assert assignment_resp.status_code == 201, assignment_resp.text

    udf_def_resp = await client.post("/api/v1/user-defined-fields/definitions", json={
        "project_id": str(project.id), "entity_type": "activity", "name": "Risk Rating", "data_type": "text",
    })
    assert udf_def_resp.status_code == 201, udf_def_resp.text
    udf_def = udf_def_resp.json()
    udf_value_resp = await client.put(
        f"/api/v1/user-defined-fields/values/{udf_def['id']}/{task_a['id']}", json={"value_text": "High"}
    )
    assert udf_value_resp.status_code == 200, udf_value_resp.text

    return {"wbs": wbs, "task_a": task_a, "task_b": task_b, "resource": resource, "calendar": calendar}


async def test_xml_export_is_well_formed(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    await _seed_schedule(client, project, live_schedule_period)

    resp = await client.get("/api/v1/p6-export/xml", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.status_code == 200, resp.text
    assert "attachment" in resp.headers["content-disposition"]

    root = ET.fromstring(resp.text)  # raises if not well-formed
    ns = {"p6": "http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects"}

    # Calendar/Resource are top-level siblings of Project — Activity/WBS/
    # Relationship/ResourceAssignment are nested *inside* Project (confirmed
    # against the real reference file, see p6_export_xml.py's own header).
    assert root.find("p6:Calendar", ns) is not None
    assert root.find("p6:Resource", ns) is not None
    project_el = root.find("p6:Project", ns)
    assert project_el is not None
    assert project_el.find("p6:WBS", ns) is not None
    assert project_el.find("p6:Activity", ns) is not None
    assert project_el.find("p6:Relationship", ns) is not None
    assert project_el.find("p6:ResourceAssignment", ns) is not None

    activity_names = {el.findtext("p6:Name", namespaces=ns) for el in project_el.findall("p6:Activity", ns)}
    assert "Excavate & Prep" in activity_names
    assert "Pour Concrete" in activity_names

    wbs_names = {el.findtext("p6:Name", namespaces=ns) for el in project_el.findall("p6:WBS", ns)}
    assert "Structure" in wbs_names

    rel = project_el.find("p6:Relationship", ns)
    assert rel.findtext("p6:Type", namespaces=ns) == "Finish to Start"
    assert rel.findtext("p6:Lag", namespaces=ns) == "8.00"

    # ResourceRate — a resource's rate lives in its own top-level element,
    # not on <Resource> itself (2026-07-15 regression, same root cause as
    # the XER RSRCRATE fix: omitting this entirely left resources with no
    # cost basis on import). J. Davies is £450/day at the default 8h/day,
    # so the correct written PricePerUnit is the hourly-equivalent £56.25
    # (RSRCRATE prices per the resource's own cost_qty_type, QT_Hour for
    # labour — writing the raw day rate would price 8x too high).
    rate_el = root.find("p6:ResourceRate", ns)
    assert rate_el is not None
    assert rate_el.findtext("p6:PricePerUnit", namespaces=ns) == "56.25"

    # ResourceAssignment must carry a real WBSObjectId (2026-07-15
    # regression — the trimmed version omitted it entirely despite the real
    # sample carrying it on every row).
    assignment_el = project_el.find("p6:ResourceAssignment", ns)
    wbs_object_id = assignment_el.find("p6:WBSObjectId", ns)
    assert wbs_object_id is not None
    assert wbs_object_id.get("{http://www.w3.org/2001/XMLSchema-instance}nil") != "true"


async def test_resource_ids_are_unique_even_with_shared_name_prefix(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    """Real bug found on the actual Snowdon project (2026-07-16, per Maro:
    "resource rates didnt transfer exactly. so costs were off") — <Id> used
    to be the resource's own name truncated to 20 characters, so any two
    resources sharing a >=20-char prefix (Generate Schedule's own per-task
    crew naming produces plenty of these, e.g. "Concrete Pour Crew (Footings
    — Pour Concrete)" and "Concrete Pour Crew (Walls — Pour Concrete)" both
    truncate to "Concrete Pour Crew (") got the same P6 Resource ID. P6
    requires that ID to be unique in its resource pool, so 37 real exported
    resources P6-side silently collapsed to 23, permanently losing the other
    14 resources' own rates. <Id> is now a small guaranteed-unique code
    instead — the full name still round-trips via <Name>."""
    task = await _create_activity(client, project, live_schedule_period, "Pour Concrete", duration_hours=8)
    for suffix, rate in (("Footings — Pour Concrete)", "1200"), ("Walls — Pour Concrete)", "1800")):
        resource_resp = await client.post("/api/v1/resources/", json={
            "project_id": str(project.id), "resource_type": "labour",
            "name": f"Concrete Pour Crew ({suffix}", "unit": "day", "rate": rate,
        })
        assert resource_resp.status_code == 201, resource_resp.text
        assignment_resp = await client.post("/api/v1/resource-assignments/", json={
            "activity_id": task["id"], "resource_id": resource_resp.json()["id"], "utilisation_pct": "100",
        })
        assert assignment_resp.status_code == 201, assignment_resp.text

    resp = await client.get("/api/v1/p6-export/xml", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.status_code == 200, resp.text
    root = ET.fromstring(resp.text)
    ns = {"p6": "http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects"}

    resource_els = root.findall("p6:Resource", ns)
    assert len(resource_els) == 2
    ids = [el.findtext("p6:Id", namespaces=ns) for el in resource_els]
    assert len(set(ids)) == 2, f"duplicate <Id> across distinct resources: {ids}"
    # Sanitized like every other exported name — the em dash isn't
    # meaningful here, just proving <Name> still carries the *full*,
    # untruncated text even though <Id> above had to become a short code.
    names = {el.findtext("p6:Name", namespaces=ns) for el in resource_els}
    assert names == {"Concrete Pour Crew (Footings - Pour Concrete)", "Concrete Pour Crew (Walls - Pour Concrete)"}


async def test_activity_names_are_p6_clean(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    """2026-07-16, per Maro testing a real P6 import: em dashes in
    task/WBS names came through as "weird symbols," and every activity
    nested under a storey WBS redundantly repeated that storey's own name
    (e.g. a task named "Elevator Pit — Footings — Excavate & Prep" nested
    under a WBS *already* named "Elevator Pit" — P6 shows the nesting
    itself, so restating the storey name on every one of its children is
    pure clutter). Reproduces Generate Schedule's own real naming
    convention (storeyGeneration.ts): "{storey} — {category} — {phase}"."""
    wbs = await _create_activity(client, project, live_schedule_period, "Elevator Pit", activity_type="wbs_summary")
    await _create_activity(
        client, project, live_schedule_period, "Elevator Pit — Footings — Excavate & Prep",
        parent_id=wbs["id"], duration_hours=8,
    )

    resp = await client.get("/api/v1/p6-export/xml", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.status_code == 200, resp.text
    root = ET.fromstring(resp.text)
    ns = {"p6": "http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects"}
    project_el = root.find("p6:Project", ns)

    wbs_names = {el.findtext("p6:Name", namespaces=ns) for el in project_el.findall("p6:WBS", ns)}
    assert "Elevator Pit" in wbs_names
    assert not any(n and "—" in n for n in wbs_names), "em dash survived into a WBS name"

    activity_names = {el.findtext("p6:Name", namespaces=ns) for el in project_el.findall("p6:Activity", ns)}
    assert "Footings - Excavate & Prep" in activity_names, activity_names
    assert not any(n and "—" in n for n in activity_names), "em dash survived into an activity name"
    assert not any(n and n.startswith("Elevator Pit") for n in activity_names), "redundant parent-WBS prefix survived"


async def test_p6_export_404s_for_unknown_schedule_period(client: AsyncClient):
    resp = await client.get("/api/v1/p6-export/xml", params={"schedule_period_id": str(uuid.uuid4())})
    assert resp.status_code == 404
