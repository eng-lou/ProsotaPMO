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


async def test_project_writes_both_id_and_name(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    """Real bug (2026-09-06, per Maro re-importing an exported project back
    into P6): <Project> only ever wrote <Id> (the full project name,
    verbatim) and never a <Name> at all — P6 showed the real name sitting
    in its "Project ID" column and its own "(New WBS)" placeholder in the
    "Project Name" column instead. <Id> is now a short code derived from
    the name (never the name verbatim — Project IDs are conventionally
    short); <Name> carries the real, full name."""
    await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=8)

    resp = await client.get("/api/v1/p6-export/xml", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.status_code == 200, resp.text
    root = ET.fromstring(resp.text)
    ns = {"p6": "http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects"}
    project_el = root.find("p6:Project", ns)

    assert project_el.findtext("p6:Name", namespaces=ns) == project.name
    project_id_code = project_el.findtext("p6:Id", namespaces=ns)
    assert project_id_code
    assert project_id_code != project.name
    assert len(project_id_code) <= 20


async def test_active_baseline_is_exported(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    """Real bug (2026-09-06, per Maro): a re-imported exported project's
    own BL1 Start/Finish just mirrored the live dates in P6 — this export
    never wrote a <BaselineProject> at all, so P6 had nothing to show as a
    real baseline. Only the currently-ASSIGNED baseline is exported
    (matching what Activity.bl_start/bl_finish already reflects
    everywhere else in Prosota), not every named snapshot ever captured."""
    task = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=8)

    baseline_resp = await client.post("/api/v1/schedule-baselines/", json={
        "schedule_period_id": str(live_schedule_period.id), "name": "Client Baseline", "baseline_date": "2026-01-01",
    })
    assert baseline_resp.status_code == 201, baseline_resp.text
    baseline_id = baseline_resp.json()["id"]
    assign_resp = await client.post(f"/api/v1/schedule-baselines/{baseline_id}/assign")
    assert assign_resp.status_code == 200, assign_resp.text

    resp = await client.get("/api/v1/p6-export/xml", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.status_code == 200, resp.text
    root = ET.fromstring(resp.text)
    ns = {"p6": "http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects"}

    baseline_el = root.find("p6:BaselineProject", ns)
    assert baseline_el is not None, "no <BaselineProject> in the export"
    assert baseline_el.findtext("p6:Name", namespaces=ns) == "Client Baseline"
    baseline_activity_els = baseline_el.findall("p6:Activity", ns)
    assert len(baseline_activity_els) == 1
    assert baseline_activity_els[0].findtext("p6:Id", namespaces=ns) == task["code"]

    project_el = root.find("p6:Project", ns)
    current_baseline_id = project_el.findtext("p6:CurrentBaselineProjectObjectId", namespaces=ns)
    assert current_baseline_id == baseline_el.findtext("p6:ObjectId", namespaces=ns)


async def test_no_baseline_project_when_none_is_assigned(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=8)

    resp = await client.get("/api/v1/p6-export/xml", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.status_code == 200, resp.text
    root = ET.fromstring(resp.text)
    ns = {"p6": "http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects"}
    assert root.find("p6:BaselineProject", ns) is None


async def test_actual_cost_and_units_are_exported_and_prorated(
    client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod
):
    """Real bug (2026-09-06, per Maro): ActualCost/ActualUnits were always
    hardcoded to 0 on every exported <ResourceAssignment>, so a re-import
    into P6 showed Earned Value and Actual Cost "missing completely" —
    "progress is missing entirely." Prosota tracks one real actuals figure
    per ACTIVITY (CostElement.actuals), not per individual resource
    assignment the way P6 natively does — an activity with two assignments
    at a 3:1 planned-cost ratio should see its one real actuals figure
    split the same 3:1 way, not evenly or arbitrarily."""
    task = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=8)
    resource_a = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "Labourer", "unit": "day", "rate": "300",
    })
    resource_b = await client.post("/api/v1/resources/", json={
        "project_id": str(project.id), "resource_type": "labour", "name": "Foreman", "unit": "day", "rate": "100",
    })
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": task["id"], "resource_id": resource_a.json()["id"], "utilisation_pct": "100",
    })
    await client.post("/api/v1/resource-assignments/", json={
        "activity_id": task["id"], "resource_id": resource_b.json()["id"], "utilisation_pct": "100",
    })
    # BAC = (300 + 100) * 1 day = 400 — 300/400 = 75% to Labourer, 25% to Foreman.
    elements = (await client.get("/api/v1/cost-elements/", params={
        "project_id": str(project.id), "period_id": (await client.get(
            "/api/v1/periods/", params={"project_id": str(project.id)}
        )).json()[0]["id"],
    })).json()
    element = next(e for e in elements if e["source"] == "schedule")
    patch_resp = await client.patch(f"/api/v1/cost-elements/{element['id']}", json={"actuals": "200"})
    assert patch_resp.status_code == 200, patch_resp.text

    resp = await client.get("/api/v1/p6-export/xml", params={"schedule_period_id": str(live_schedule_period.id)})
    assert resp.status_code == 200, resp.text
    root = ET.fromstring(resp.text)
    ns = {"p6": "http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects"}
    project_el = root.find("p6:Project", ns)

    rsrc_id_by_name = {
        el.findtext("p6:Name", namespaces=ns): el.findtext("p6:ObjectId", namespaces=ns)
        for el in root.findall("p6:Resource", ns)
    }
    assignment_els = project_el.findall("p6:ResourceAssignment", ns)
    assert len(assignment_els) == 2
    actual_cost_by_rsrc_id = {
        el.findtext("p6:ResourceObjectId", namespaces=ns): float(el.findtext("p6:ActualCost", namespaces=ns))
        for el in assignment_els
    }
    total_actual = sum(actual_cost_by_rsrc_id.values())
    assert abs(total_actual - 200.0) < 0.01, actual_cost_by_rsrc_id  # the exact real figure, not lost to rounding

    labourer_actual = actual_cost_by_rsrc_id[rsrc_id_by_name["Labourer"]]
    foreman_actual = actual_cost_by_rsrc_id[rsrc_id_by_name["Foreman"]]
    assert abs(labourer_actual - 150.0) < 0.01  # 75% of 200
    assert abs(foreman_actual - 50.0) < 0.01    # 25% of 200


async def test_p6_export_404s_for_unknown_schedule_period(client: AsyncClient):
    resp = await client.get("/api/v1/p6-export/xml", params={"schedule_period_id": str(uuid.uuid4())})
    assert resp.status_code == 404
