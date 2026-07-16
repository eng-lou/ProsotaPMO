from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schedule_period import SchedulePeriod
from app.models.project import Project

# Monday anchor — keeps expected dates deterministic without replicating
# working-day-skipping arithmetic in the tests themselves. Standard Calendar is
# 08:00-17:00 with a 12:00-13:00 lunch break (net 8h/day) — see
# app/services/calendar.py.
_MONDAY = date(2025, 6, 2)


async def _anchor(db: AsyncSession, period: SchedulePeriod) -> None:
    period.start_date = _MONDAY
    await db.commit()


async def _use_hour_precision(client: AsyncClient, project: Project) -> str:
    """Every calendar defaults to whole_day_scheduling=True now (2026-07-13,
    per Maro: "let it be whole day by default... i dont want that option" —
    no longer a user-facing toggle, but the underlying per-calendar field and
    the CPM engine's own conditional branch are both still real and still
    tested, see test_scheduling_cpm_whole_day.py). The tests in this file
    that specifically exercise sub-day mechanics (lunch breaks, partial-day
    exceptions, a lag landing mid-day) opt the lazily-seeded Standard
    Calendar back into hour-precision explicitly, via a direct PATCH — that
    remains a fully supported API call even with no UI control left for it —
    so their own real intent (does a break/exception genuinely change a
    computed clock time) keeps being exercised regardless of what the new
    default is."""
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    standard_id = calendars.json()[0]["id"]
    resp = await client.patch(f"/api/v1/calendars/{standard_id}", json={"whole_day_scheduling": False})
    assert resp.status_code == 200, resp.text
    return standard_id


async def _create_activity(client: AsyncClient, project: Project, period: SchedulePeriod, task_name: str, **overrides) -> dict:
    payload = {"project_id": str(project.id), "schedule_period_id": str(period.id), "task_name": task_name}
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


async def test_isolated_activity_starts_on_anchor(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    assert a["start"] == "2025-06-02T08:00:00"   # Monday, day envelope opens 08:00
    assert a["finish"] == "2025-06-06T17:00:00"  # Friday — 5 working days (40h / 8h) later
    assert float(a["total_float_hours"]) == 0.0
    assert a["is_critical"] is True


async def test_fs_chain_pushes_successor_start(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    b = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=40)
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


async def test_fs_lag_delays_successor_further(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    await _use_hour_precision(client, project)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    b = await _create_activity(client, project, live_schedule_period, "Piling", duration_hours=40)
    await _link(client, a, b, lag_hours=16)

    b = await _get(client, b["id"])
    # a finishes Fri 06/06 17:00; the zero-lag FS candidate snaps to Mon 09/06 08:00,
    # then +16 working hours (exactly 2 more full 8h working days: Mon+Tue) -> lands
    # at the close of Tue 10/06.
    assert b["start"] == "2025-06-10T17:00:00"


async def test_ss_relationship_aligns_starts(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Design", duration_hours=80)
    b = await _create_activity(client, project, live_schedule_period, "Procurement", duration_hours=40)
    await _link(client, a, b, relationship_type="SS")

    b = await _get(client, b["id"])
    assert b["start"] == "2025-06-02T08:00:00"  # same start as predecessor


async def test_parallel_paths_only_longer_one_is_critical(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    start = await _create_activity(client, project, live_schedule_period, "Mobilise", duration_hours=8)
    long_path = await _create_activity(client, project, live_schedule_period, "Long task", duration_hours=80)
    short_path = await _create_activity(client, project, live_schedule_period, "Short task", duration_hours=16)
    finish = await _create_activity(client, project, live_schedule_period, "Handover", duration_hours=8)

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


async def test_start_milestone_has_zero_span(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Design started", activity_type="start_milestone")
    # CPM math unchanged from the old single "milestone" type (2026-07-07,
    # per Maro) — both fields stay populated and equal internally, since CPM
    # needs a concrete instant to schedule from either way; only which one
    # the frontend shows/edits differs.
    assert a["start"] == a["finish"] == "2025-06-02T08:00:00"


async def test_finish_milestone_has_zero_span(client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Design complete", activity_type="finish_milestone")
    assert a["start"] == a["finish"] == "2025-06-02T08:00:00"


async def test_ff_zero_lag_does_not_drift_a_finish_milestone_forward(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """Regression for a real roofing schedule (2026-07-07, per Maro): a
    Finish Milestone with an FS predecessor (earlier finish) and an FF
    predecessor (later finish, exactly at a working day's close) was showing
    a date one full day later than the FF predecessor's actual finish —
    offset_hours' snap-forward (meant for turning a finish into the next
    *start* instant) was wrongly applied to the FF candidate's own
    finish-type anchor. The milestone should land exactly on the later,
    FF-driven finish, not a day past it."""
    await _anchor(db, live_schedule_period)
    fs_pred = await _create_activity(client, project, live_schedule_period, "Built-Up Asphalt Roofing", duration_hours=24)
    ff_pred = await _create_activity(client, project, live_schedule_period, "Felt and Tile Roofing", duration_hours=40)
    milestone = await _create_activity(client, project, live_schedule_period, "Roof Complete", activity_type="finish_milestone")
    await _link(client, fs_pred, milestone)  # default FS
    await _link(client, ff_pred, milestone, relationship_type="FF")

    ff_pred = await _get(client, ff_pred["id"])
    milestone = await _get(client, milestone["id"])
    assert ff_pred["finish"] == "2025-06-06T17:00:00"  # Friday close — 5 working days (40h / 8h)
    assert milestone["finish"] == ff_pred["finish"]
    assert milestone["start"] == milestone["finish"]


async def test_mandatory_start_constraint_overrides_predecessor_derived_start(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    b = await _create_activity(
        client, project, live_schedule_period, "Piling", duration_hours=40,
        constraint_type="ms", constraint_date="2025-06-02T08:00:00",  # same instant as the predecessor's own start
    )
    await _link(client, a, b)

    b = await _get(client, b["id"])
    # Hard constraint wins over the FS-derived candidate (would otherwise be 2025-06-09).
    assert b["start"] == "2025-06-02T08:00:00"


async def test_fnlt_constraint_can_create_negative_float(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    # FS from a would naturally place this milestone on 2025-06-09 08:00 (the next
    # working instant after a finishes), but a Finish On or Before deadline of
    # Wednesday close forces it two working days earlier than that — logically
    # infeasible given the predecessor, which is exactly what negative float signals.
    milestone = await _create_activity(
        client, project, live_schedule_period, "Design freeze", activity_type="finish_milestone",
        constraint_type="fnlt", constraint_date="2025-06-04T17:00:00",
    )
    await _link(client, a, milestone)  # default FS — valid for a finish_milestone

    milestone = await _get(client, milestone["id"])
    assert milestone["start"] == "2025-06-09T08:00:00"       # ES still derived from the predecessor
    assert float(milestone["total_float_hours"]) == -16.0    # 2 working days short of the deadline


async def test_snet_constraint_pushes_start_later(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(
        client, project, live_schedule_period, "Excavation", duration_hours=40,
        constraint_type="snet", constraint_date="2025-06-16T08:00:00",
    )
    assert a["start"] == "2025-06-16T08:00:00"


async def test_snlt_constraint_can_create_negative_float(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    # FS from a would naturally place b's start on 2025-06-09 08:00 (the next
    # working instant after a finishes), but a Start On or Before deadline of
    # Wednesday close caps its Late Start two working days earlier than
    # that — logically infeasible given the predecessor, which is exactly
    # what negative float signals (the start-side mirror of fnlt's own test —
    # ES itself is untouched, only the LS ceiling moves).
    b = await _create_activity(
        client, project, live_schedule_period, "Piling", duration_hours=8,
        constraint_type="snlt", constraint_date="2025-06-04T17:00:00",
    )
    await _link(client, a, b)  # default FS

    b = await _get(client, b["id"])
    assert b["start"] == "2025-06-09T08:00:00"       # ES still derived from the predecessor
    assert float(b["total_float_hours"]) == -16.0    # 2 working days short of the deadline


async def test_fnet_constraint_floors_finish_without_moving_start(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    # Natural finish (1 working day, no predecessors) would be Monday 17:00 —
    # a Finish On or After floor of Wednesday close holds EF there instead,
    # without moving ES backward to compensate (unlike mf, which is a hard
    # pin that *does* re-derive ES) — it reads as the duration stretching to
    # meet the floor while Start stays exactly where it naturally lands.
    a = await _create_activity(
        client, project, live_schedule_period, "Survey", duration_hours=8,
        constraint_type="fnet", constraint_date="2025-06-04T17:00:00",
    )
    assert a["start"] == "2025-06-02T08:00:00"
    assert a["finish"] == "2025-06-04T17:00:00"


async def test_mandatory_finish_constraint_overrides_forward_derived_finish(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    b = await _create_activity(
        client, project, live_schedule_period, "Piling", duration_hours=40,
        # FS from a would naturally place this on 2025-06-09 08:00 -> 2025-06-13
        # 17:00; mf pins the finish two working days earlier than that, ignoring
        # the predecessor entirely — same "mandatory overrides logic even if it
        # lands somewhere impossible" behaviour Mandatory Start already has.
        constraint_type="mf", constraint_date="2025-06-11T17:00:00",
    )
    await _link(client, a, b)

    b = await _get(client, b["id"])
    assert b["finish"] == "2025-06-11T17:00:00"
    # ES is derived *backward* from the pinned EF (5 working days back from Wed
    # 06/11 close = Thu 06/05 open) — completely ignoring the predecessor, which
    # doesn't even finish until Fri 06/06. That's the correct, expected
    # consequence of "mandatory," not a bug — the same way an unrealistic
    # Mandatory Start date can already schedule an activity before logic allows.
    assert b["start"] == "2025-06-05T08:00:00"


async def test_alap_activity_schedules_late_without_delaying_successor(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    start = await _create_activity(client, project, live_schedule_period, "Mobilise", duration_hours=8)
    long_path = await _create_activity(client, project, live_schedule_period, "Long task", duration_hours=80)
    short_path_plain = await _create_activity(client, project, live_schedule_period, "Short task (plain)", duration_hours=40)
    short_path_alap = await _create_activity(
        client, project, live_schedule_period, "Short task (ALAP)", duration_hours=40, constraint_type="alap",
    )
    finish = await _create_activity(client, project, live_schedule_period, "Handover", duration_hours=8)

    await _link(client, start, long_path)
    await _link(client, start, short_path_plain)
    await _link(client, start, short_path_alap)
    await _link(client, long_path, finish)
    await _link(client, short_path_plain, finish)
    await _link(client, short_path_alap, finish)

    short_path_plain = await _get(client, short_path_plain["id"])
    short_path_alap = await _get(client, short_path_alap["id"])
    finish = await _get(client, finish["id"])

    # Both short-path activities have the same real slack (same total float) —
    # ALAP doesn't change *how much* float there is, only where within it the
    # activity is displayed.
    assert short_path_alap["total_float_hours"] == short_path_plain["total_float_hours"]
    assert float(short_path_alap["total_float_hours"]) > 0
    # "Critical" still means zero float, not "displayed at its late date".
    assert short_path_alap["is_critical"] is False

    # ALAP pushes it later than the plain (early-scheduled) version...
    assert short_path_alap["start"] > short_path_plain["start"]
    assert short_path_alap["finish"] > short_path_plain["finish"]
    # ...and it finishes at exactly its own Late Finish, i.e. right when the
    # successor needs it — the whole point of "as late as possible".
    assert short_path_alap["finish"] == finish["start"]


async def test_alap_ignored_once_activity_has_progress(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    start = await _create_activity(client, project, live_schedule_period, "Mobilise", duration_hours=8)
    long_path = await _create_activity(client, project, live_schedule_period, "Long task", duration_hours=80)
    short_path = await _create_activity(
        client, project, live_schedule_period, "Short task (ALAP)", duration_hours=40, constraint_type="alap",
    )
    await _link(client, start, long_path)
    await _link(client, start, short_path)

    early_start = (await _get(client, short_path["id"]))["start"]

    # Logging progress makes Start a recorded fact — ALAP must not keep
    # pushing it later after that, same precedent every other constraint type
    # already follows once pct_complete > 0.
    resp = await client.patch(f"/api/v1/activities/{short_path['id']}", json={"pct_complete": "10"})
    assert resp.status_code == 200
    assert resp.json()["start"] == early_start


async def test_reject_cycle_via_relationship_chain(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "A", duration_hours=8)
    b = await _create_activity(client, project, live_schedule_period, "B", duration_hours=8)
    c = await _create_activity(client, project, live_schedule_period, "C", duration_hours=8)
    await _link(client, a, b)
    await _link(client, b, c)

    resp = await client.post("/api/v1/activity-relationships/", json={
        "predecessor_id": c["id"], "successor_id": a["id"],
    })
    assert resp.status_code == 422
    assert "circular" in resp.json()["detail"].lower()


async def test_calendar_exception_skips_non_working_day(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    standard_id = calendars.json()[0]["id"]

    # Close the Wednesday that would otherwise fall inside a 3-day task starting Monday.
    await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": standard_id, "label": "Site shutdown",
        "start_date": "2025-06-04", "end_date": "2025-06-04", "is_working": False,
    })

    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=24)
    # Mon 02, Tue 03, [Wed 04 closed], Thu 05 -> finishes Thursday instead of Wednesday.
    assert a["start"] == "2025-06-02T08:00:00"
    assert a["finish"] == "2025-06-05T17:00:00"


async def test_partial_day_exception_removes_a_morning_hour(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """Phase 10: a partial-day exception (e.g. "08:00-09:00 non-working") should
    genuinely change a computed finish time, not just display as a label."""
    await _anchor(db, live_schedule_period)
    standard_id = await _use_hour_precision(client, project)

    await client.post("/api/v1/calendar-exceptions/", json={
        "calendar_id": standard_id, "label": "Late start (delivery)",
        "start_date": "2025-06-02", "end_date": "2025-06-02", "is_working": False,
        "start_time": "08:00:00", "end_time": "09:00:00",
    })

    # 8 working hours starting Monday, but Monday only has 7 available (08:00-17:00
    # minus the 08:00-09:00 exception minus the 12:00-13:00 lunch break) -> the last
    # hour spills into Tuesday morning.
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=8)
    assert a["start"] == "2025-06-02T09:00:00"
    assert a["finish"] == "2025-06-03T09:00:00"


async def test_calendar_break_is_excluded_from_working_time(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    await _use_hour_precision(client, project)
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    standard = calendars.json()[0]
    assert float(standard["hours_per_day"]) == 8.0  # 08:00-17:00 minus the seeded 12:00-13:00 lunch

    # A 5-hour task starting 10:00 spans the lunch break -> finishes at 16:00, not 15:00.
    a = await _create_activity(
        client, project, live_schedule_period, "Concrete pour", duration_hours=5,
        constraint_type="snet", constraint_date="2025-06-02T10:00:00",
    )
    assert a["start"] == "2025-06-02T10:00:00"
    assert a["finish"] == "2025-06-02T16:00:00"


async def test_activity_specific_calendar_overrides_project_default(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
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
        client, project, live_schedule_period, "Concrete pour", duration_hours=54, calendar_id=calendar_id,
    )
    assert a["finish"] == "2025-06-07T17:00:00"


async def test_start_finish_not_accepted_as_input(client: AsyncClient, project: Project, live_schedule_period: SchedulePeriod):
    resp = await client.post("/api/v1/activities/", json={
        "project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id),
        "task_name": "Piling", "start": "1999-01-01T00:00:00", "finish": "1999-01-01T00:00:00",
    })
    assert resp.status_code == 201
    assert resp.json()["start"] != "1999-01-01T00:00:00"


async def test_editing_finish_recomputes_duration(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    """P6/MS Project convention: editing Finish changes Duration, Start stays put —
    editing Start instead applies a soft Start On or After constraint (frontend
    responsibility, app/services/activity.py never accepts "start" as literal input)."""
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
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
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=40)
    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={"finish": "2025-06-01T08:00:00"})
    assert resp.status_code == 422


async def test_wbs_summary_excluded_from_cpm_network(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod
):
    await _anchor(db, live_schedule_period)
    parent = await _create_activity(client, project, live_schedule_period, "Phase 1")
    await _create_activity(client, project, live_schedule_period, "Piling", parent_id=parent["id"], duration_hours=40)

    parent = await _get(client, parent["id"])
    assert parent["activity_type"] == "wbs_summary"
    assert parent["total_float_hours"] is None
    assert parent["is_critical"] is None
