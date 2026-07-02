from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.models.project import Project

# Monday anchor — keeps expected dates deterministic without replicating
# working-day-skipping arithmetic in the tests themselves.
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
    a = await _create_activity(client, project, live_period, "Excavation", duration_days=5)
    assert a["start"] == "2025-06-02"   # Monday
    assert a["finish"] == "2025-06-06"  # Friday — 5-day (Mon-Fri) duration
    assert a["total_float"] == 0
    assert a["is_critical"] is True


async def test_fs_chain_pushes_successor_start(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_days=5)
    b = await _create_activity(client, project, live_period, "Piling", duration_days=5)
    await _link(client, a, b)

    b = await _get(client, b["id"])
    # a finishes Friday 06/06; FS with lag=0 -> b starts the next working day, Monday 09/06.
    assert b["start"] == "2025-06-09"
    assert b["finish"] == "2025-06-13"
    # Both activities are on the only path through the network -> both critical, zero float.
    a = await _get(client, a["id"])
    assert a["is_critical"] is True
    assert b["is_critical"] is True


async def test_fs_lag_delays_successor_further(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_days=5)
    b = await _create_activity(client, project, live_period, "Piling", duration_days=5)
    await _link(client, a, b, lag_days=2)

    b = await _get(client, b["id"])
    # Next working day after 06/06 is Mon 09/06; +2 more working days -> Wed 11/06.
    assert b["start"] == "2025-06-11"


async def test_ss_relationship_aligns_starts(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Design", duration_days=10)
    b = await _create_activity(client, project, live_period, "Procurement", duration_days=5)
    await _link(client, a, b, relationship_type="SS")

    b = await _get(client, b["id"])
    assert b["start"] == "2025-06-02"  # same start as predecessor


async def test_parallel_paths_only_longer_one_is_critical(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    start = await _create_activity(client, project, live_period, "Mobilise", duration_days=1)
    long_path = await _create_activity(client, project, live_period, "Long task", duration_days=10)
    short_path = await _create_activity(client, project, live_period, "Short task", duration_days=2)
    finish = await _create_activity(client, project, live_period, "Handover", duration_days=1)

    await _link(client, start, long_path)
    await _link(client, start, short_path)
    await _link(client, long_path, finish)
    await _link(client, short_path, finish)

    long_path = await _get(client, long_path["id"])
    short_path = await _get(client, short_path["id"])
    assert long_path["is_critical"] is True
    assert long_path["total_float"] == 0
    assert short_path["is_critical"] is False
    assert short_path["total_float"] > 0


async def test_milestone_has_zero_span(client: AsyncClient, db: AsyncSession, project: Project, live_period: Period):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Design complete", activity_type="milestone")
    assert a["start"] == a["finish"] == "2025-06-02"


async def test_mandatory_start_constraint_overrides_predecessor_derived_start(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_days=5)
    b = await _create_activity(
        client, project, live_period, "Piling", duration_days=5,
        constraint_type="ms", constraint_date="2025-06-02",  # same day as the predecessor's own start
    )
    await _link(client, a, b)

    b = await _get(client, b["id"])
    # Hard constraint wins over the FS-derived candidate (would otherwise be 2025-06-09).
    assert b["start"] == "2025-06-02"


async def test_fnlt_constraint_can_create_negative_float(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "Excavation", duration_days=5)
    # FS from a would naturally place this milestone on 2025-06-09 (the next working
    # day after a finishes), but a Finish On or Before deadline forces it no later
    # than a's own finish date — logically infeasible given the predecessor, which is
    # exactly what negative float signals.
    milestone = await _create_activity(
        client, project, live_period, "Design freeze", activity_type="milestone",
        constraint_type="fnlt", constraint_date="2025-06-06",
    )
    await _link(client, a, milestone)

    milestone = await _get(client, milestone["id"])
    assert milestone["start"] == "2025-06-09"  # ES still derived from the predecessor
    assert milestone["total_float"] < 0        # but the deadline can't actually be met


async def test_snet_constraint_pushes_start_later(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(
        client, project, live_period, "Excavation", duration_days=5,
        constraint_type="snet", constraint_date="2025-06-16",
    )
    assert a["start"] == "2025-06-16"


async def test_reject_cycle_via_relationship_chain(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    a = await _create_activity(client, project, live_period, "A", duration_days=1)
    b = await _create_activity(client, project, live_period, "B", duration_days=1)
    c = await _create_activity(client, project, live_period, "C", duration_days=1)
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

    a = await _create_activity(client, project, live_period, "Excavation", duration_days=3)
    # Mon 02, Tue 03, [Wed 04 closed], Thu 05 -> finishes Thursday instead of Wednesday.
    assert a["start"] == "2025-06-02"
    assert a["finish"] == "2025-06-05"


async def test_activity_specific_calendar_overrides_project_default(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    saturday_cal = await client.post("/api/v1/calendars/", json={
        "project_id": str(project.id), "name": "Saturday Working", "works_saturday": True,
    })
    calendar_id = saturday_cal.json()["id"]

    # Duration 6 starting Monday: with Saturday available, finishes Saturday 07/06
    # instead of the following Monday a plain Mon-Fri calendar would need.
    a = await _create_activity(
        client, project, live_period, "Concrete pour", duration_days=6, calendar_id=calendar_id,
    )
    assert a["finish"] == "2025-06-07"


async def test_start_finish_not_accepted_as_input(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "task_name": "Piling", "start": "1999-01-01", "finish": "1999-01-01",
    })
    assert resp.status_code == 201
    assert resp.json()["start"] != "1999-01-01"


async def test_wbs_summary_excluded_from_cpm_network(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    await _anchor(db, live_period)
    parent = await _create_activity(client, project, live_period, "Phase 1")
    await _create_activity(client, project, live_period, "Piling", parent_id=parent["id"], duration_days=5)

    parent = await _get(client, parent["id"])
    assert parent["activity_type"] == "wbs_summary"
    assert parent["total_float"] is None
    assert parent["is_critical"] is None
