from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.models.project import Project

# Monday anchor — keeps expected dates deterministic without replicating
# working-day-skipping arithmetic in the tests themselves. Standard Calendar is
# 08:00-17:00 with a 12:00-13:00 lunch break (net 8h/day) — see
# app/services/calendar.py.
_MONDAY = date(2025, 6, 2)


async def _anchor(db: AsyncSession, period: Period) -> None:
    period.start_date = _MONDAY
    await db.commit()


async def _create_activity(client: AsyncClient, project: Project, period: Period, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "task_name": task_name}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _link(client: AsyncClient, pred: dict, succ: dict, **overrides) -> dict:
    payload = {"predecessor_id": pred["id"], "successor_id": succ["id"]}
    payload.update(overrides)
    resp = await client.post("/api/v1/activity-relationships/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _get(client: AsyncClient, activity_id: str) -> dict:
    resp = await client.get(f"/api/v1/activities/{activity_id}")
    assert resp.status_code == 200
    return resp.json()


async def test_isolated_activity_starts_on_anchor(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=40)
    assert a["start"] == "2025-06-02T08:00:00"   # Monday, day envelope opens 08:00
    assert a["finish"] == "2025-06-06T17:00:00"  # Friday — 5 working days (40h / 8h) later
    assert float(a["total_float_hours"]) == 0.0
    assert a["is_critical"] is True


async def test_fs_chain_pushes_successor_start(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=40)
    b = await _create_activity(client, project, live_period, "Piling", duration_hours=40)
    await _link(client, a, b)

    b = await _get(client, b["id"])
    # a finishes Friday 06/06 17:00 (the envelope closes) -> FS with lag=0 rolls to the
    # next working instant, Monday 09/06 08:00 (Phase 10: no more artificial "+1 day").
    assert b["start"] == "2025-06-09T08:00:00"
    assert b["finish"] == "2025-06-13T17:00:00"
    # Both activities are on the only path through the network -> both critical, zero float.
    a = await _get(client, a["id"])
    assert a["is_critical"] is True
    assert b["is_critical"] is True


async def test_fs_lag_delays_successor_further(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=40)
    b = await _create_activity(client, project, live_period, "Piling", duration_hours=40)
    await _link(client, a, b, lag_hours=16)

    b = await _get(client, b["id"])
    # a finishes Fri 06/06 17:00; the zero-lag FS candidate snaps to Mon 09/06 08:00,
    # then +16 working hours (exactly 2 more full 8h working days: Mon+Tue) -> lands
    # at the close of Tue 10/06.
    assert b["start"] == "2025-06-10T17:00:00"


async def test_ss_relationship_aligns_starts(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Design", duration_hours=80)
    b = await _create_activity(client, project, live_period, "Procurement", duration_hours=40)
    await _link(client, a, b, relationship_type="SS")

    b = await _get(client, b["id"])
    assert b["start"] == "2025-06-02T08:00:00"  # same start as predecessor


async def test_parallel_paths_only_longer_one_is_critical(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    start = await _create_activity(client, project, live_period, "Mobilise", duration_hours=8)
    long_path = await _create_activity(client, project, live_period, "Long task", duration_hours=80)
    short_path = await _create_activity(client, project, live_period, "Short task", duration_hours=16)
    finish = await _create_activity(client, project, live_period, "Handover", duration_hours=8)

    await _link(client, start, long_path)
    await _link(client, start, short_path)
    await _link(client, long_path, finish)
    await _link(client, short_path, finish)

    long_path = await _get(client, long_path["id"])
    short_path = await _get(client, short_path["id"])
    assert long_path["is_critical"] is True
    assert long_path["total_float_hours"] == "0.00"
    assert short_path["is_critical"] is False
    assert float(short_path["total_float_hours"]) > 0


async def test_milestone_has_zero_span(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Design complete", activity_type="milestone")
    assert a["start"] == a["finish"] == "2025-06-02T08:00:00"


async def test_mandatory_start_constraint_overrides_predecessor_derived_start(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=40)
    b = await _create_activity(
        client, project, live_period, "Piling", duration_hours=40,
        constraint_type="ms", constraint_date="2025-06-02T08:00:00",  # same instant as the predecessor's own start
    )
    await _link(client, a, b)

    b = await _get(client, b["id"])
    # Hard constraint wins over the FS-derived candidate (would otherwise be 2025-06-09).
    assert b["start"] == "2025-06-02T08:00:00"


async def test_fnlt_constraint_can_create_negative_float(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=40)
    # FS from a would naturally place this milestone on 2025-06-09 08:00 (the next
    # working instant after a finishes), but a Finish On or Before deadline of
    # Wednesday close forces it two working days earlier than that — logically
    # infeasible given the predecessor, which is exactly what negative float signals.
    milestone = await _create_activity(
        client, project, live_period, "Design freeze", activity_type="milestone",
        constraint_type="fnlt", constraint_date="2025-06-04T17:00:00",
    )
    await _link(client, a, milestone)

    milestone = await _get(client, milestone["id"])
    assert milestone["start"] == "2025-06-09T08:00:00"       # ES still derived from the predecessor
    assert float(milestone["total_float_hours"]) == -16.0    # 2 working days short of the deadline


async def test_snet_constraint_pushes_start_later(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(
        client, project, live_period, "Excavation", duration_hours=40,
        constraint_type="snet", constraint_date="2025-06-16T08:00:00",
    )
    assert a["start"] == "2025-06-16T08:00:00"


async def test_reject_cycle_via_relationship_chain(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "A", duration_hours=8)
    b = await _create_activity(client, project, live_period, "B", duration_hours=8)
    c = await _create_activity(client, project, live_period, "C", duration_hours=8)
    await _link(client, a, b)
    await _link(client, b, c)

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": c["id"], "successor_id": a["id"],
    })
    assert resp.status_code == 422
    assert "circular" in resp.json()["detail"].lower()


async def test_calendar_exception_skips_non_working_day(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    standard_id = calendars.json()[0]["id"]

    # Close the Wednesday that would otherwise fall inside a 3-day task starting Monday.
    await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": standard_id, "label": "Site shutdown",
        "start_date": "2025-06-04", "end_date": "2025-06-04", "is_working": False,
    })

    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=24)
    # Mon 02, Tue 03, [Wed 04 closed], Thu 05 -> finishes Thursday instead of Wednesday.
    assert a["start"] == "2025-06-02T08:00:00"
    assert a["finish"] == "2025-06-05T17:00:00"


async def test_partial_day_exception_removes_a_morning_hour(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    """Phase 10: a partial-day exception (e.g. "08:00-09:00 non-working") should
    genuinely change a computed finish time, not just display as a label."""
    await _anchor(db, live_period)
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    standard_id = calendars.json()[0]["id"]

    await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": standard_id, "label": "Late start (delivery)",
        "start_date": "2025-06-02", "end_date": "2025-06-02", "is_working": False,
        "start_time": "08:00:00", "end_time": "09:00:00",
    })

    # 8 working hours starting Monday, but Monday only has 7 available (08:00-17:00
    # minus the 08:00-09:00 exception minus the 12:00-13:00 lunch break) -> the last
    # hour spills into Tuesday morning.
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=8)
    assert a["start"] == "2025-06-02T09:00:00"
    assert a["finish"] == "2025-06-03T09:00:00"


async def test_calendar_break_is_excluded_from_working_time(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    standard = calendars.json()[0]
    assert float(standard["hours_per_day"]) == 8.0  # 08:00-17:00 minus the seeded 12:00-13:00 lunch

    # A 5-hour task starting 10:00 spans the lunch break -> finishes at 16:00, not 15:00.
    a = await _create_activity(
        client, project, live_period, "Concrete pour", duration_hours=5,
        constraint_type="snet", constraint_date="2025-06-02T10:00:00",
    )
    assert a["start"] == "2025-06-02T10:00:00"
    assert a["finish"] == "2025-06-02T16:00:00"


async def test_activity_specific_calendar_overrides_project_default(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    saturday_cal = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Saturday Working", "works_saturday": True,
    })
    calendar_id = saturday_cal.json()["id"]

    # This calendar has no lunch break configured (only the lazily-seeded default
    # calendar gets one — see app/services/calendar.py), so its 08:00-17:00 envelope
    # is a full 9h working day. Duration 54h = 6 full 9h days starting Monday: with
    # Saturday available, finishes Saturday 07/06 instead of the following Monday a
    # plain Mon-Fri calendar would need.
    a = await _create_activity(
        client, project, live_period, "Concrete pour", duration_hours=54, calendar_id=calendar_id,
    )
    assert a["finish"] == "2025-06-07T17:00:00"


async def test_start_finish_not_accepted_as_input(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "task_name": "Piling", "start": "1999-01-01T00:00:00", "finish": "1999-01-01T00:00:00",
    })
    assert resp.status_code == 201
    assert resp.json()["start"] != "1999-01-01T00:00:00"


async def test_editing_finish_recomputes_duration(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    """P6/MS Project convention: editing Finish changes Duration, Start stays put —
    editing Start instead applies a soft Start On or After constraint (frontend
    responsibility, app/services/activity.py never accepts "start" as literal input)."""
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=40)
    assert a["start"] == "2025-06-02T08:00:00"
    assert a["finish"] == "2025-06-06T17:00:00"

    # Pull the finish in to Wednesday close -> 3 working days (24h) instead of 5.
    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={"finish": "2025-06-04T17:00:00"})
    assert resp.status_code == 200
    data = resp.json()
    assert float(data["duration_hours"]) == 24.0
    assert data["start"] == "2025-06-02T08:00:00"   # unchanged
    assert data["finish"] == "2025-06-04T17:00:00"  # recomputed from the new duration, lands back exactly


async def test_editing_finish_before_start_rejected(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_hours=40)
    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={"finish": "2025-06-01T08:00:00"})
    assert resp.status_code == 422


async def test_wbs_summary_excluded_from_cpm_network(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    parent = await _create_activity(client, project, live_period, "Phase 1")
    await _create_activity(client, project, live_period, "Piling", parent_id=parent["id"], duration_hours=40)

    parent = await _get(client, parent["id"])
    assert parent["activity_type"] == "wbs_summary"
    assert parent["total_float_hours"] is None
    assert parent["is_critical"] is None
