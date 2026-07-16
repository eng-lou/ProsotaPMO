from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.schedule_period import SchedulePeriod

# Per-Calendar "Whole-day scheduling" (2026-07-13, per Maro: "there are
# activities starting by 16:30 one day and ending 11:00 another even
# though i set the calendar... ensure the generated activities use it") —
# every activity on a whole_day_scheduling=True calendar starts exactly at
# day_start_time and finishes exactly at day_end_time, never mid-day.
# Shipped as an opt-in toggle first, then made every calendar's own default
# the same day, per Maro: "i dont want that option, let it be whole day by
# default." test_scheduling_cpm.py's own hour-precision-specific tests now
# explicitly opt back into hour-precision via a direct PATCH (see its own
# _use_hour_precision helper) — that suite staying green is still the real
# regression gate for the underlying mechanism, not just the tests here.
_MONDAY = date(2025, 6, 2)


async def _anchor(db: AsyncSession, period: SchedulePeriod) -> None:
    period.start_date = _MONDAY
    await db.commit()


async def _whole_day_calendar(client: AsyncClient, project: Project, **overrides) -> dict:
    # 08:00-16:00, no breaks (a freshly-created calendar never gets one —
    # see test_calendars.py's own test_create_calendar) -> a clean 8h/day
    # envelope, distinct from the Standard Calendar's 08:00-17:00-with-
    # lunch (9h envelope, 8h net) so a wrong fallback to the project
    # default would produce visibly different, easy-to-catch numbers.
    payload = {
        "project_id": str(project.id), "name": "Whole Day Calendar",
        "day_start_time": "08:00:00", "day_end_time": "16:00:00",
        "whole_day_scheduling": True,
    }
    payload.update(overrides)
    resp = await client.post("/api/v1/calendars/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


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


async def test_whole_day_activity_lands_exactly_on_envelope_boundaries(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod,
):
    await _anchor(db, live_schedule_period)
    cal = await _whole_day_calendar(client, project)
    a = await _create_activity(
        client, project, live_schedule_period, "Footings", duration_hours=8, calendar_id=cal["id"],
    )
    assert a["start"] == "2025-06-02T08:00:00"   # Monday, day_start_time exactly
    assert a["finish"] == "2025-06-02T16:00:00"  # same day, day_end_time exactly -- 8h = 1 whole day


async def test_whole_day_duration_not_a_multiple_of_hours_per_day_rounds_up(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod,
):
    await _anchor(db, live_schedule_period)
    cal = await _whole_day_calendar(client, project)
    # 20h needs ceil(20/8) = 3 whole days, not 2.5 -- Mon+Tue+Wed.
    a = await _create_activity(
        client, project, live_schedule_period, "Columns", duration_hours=20, calendar_id=cal["id"],
    )
    assert a["start"] == "2025-06-02T08:00:00"
    assert a["finish"] == "2025-06-04T16:00:00"  # Wednesday


async def test_whole_day_fs_successor_starts_the_next_working_day(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod,
):
    await _anchor(db, live_schedule_period)
    cal = await _whole_day_calendar(client, project)
    a = await _create_activity(client, project, live_schedule_period, "Footings", duration_hours=8, calendar_id=cal["id"])
    b = await _create_activity(client, project, live_schedule_period, "Columns", duration_hours=8, calendar_id=cal["id"])
    await _link(client, a, b)

    b = await _get(client, b["id"])
    # a finishes Monday 16:00 (day_end_time exactly) -- the successor never
    # squeezes into the same day; it starts the *next* working day at
    # day_start_time, same "whole days only" rule applied to the FS gap.
    assert b["start"] == "2025-06-03T08:00:00"
    assert b["finish"] == "2025-06-03T16:00:00"


async def test_whole_day_lag_rounds_up_to_a_whole_extra_day(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod,
):
    await _anchor(db, live_schedule_period)
    cal = await _whole_day_calendar(client, project)
    a = await _create_activity(client, project, live_schedule_period, "Footings", duration_hours=8, calendar_id=cal["id"])
    b = await _create_activity(client, project, live_schedule_period, "Columns", duration_hours=8, calendar_id=cal["id"])
    # A nonzero lag on a whole-day calendar rounds up to a whole extra day
    # too (offset_hours routes through the same add_duration branch) --
    # a deliberate, documented consequence, not a rounding bug.
    await _link(client, a, b, lag_hours=2)

    b = await _get(client, b["id"])
    # zero-lag candidate would be Tue 03/06 08:00; +2h lag rounds up to
    # +1 whole day -> Wed 04/06 08:00.
    assert b["start"] == "2025-06-04T08:00:00"


async def test_whole_day_backward_pass_produces_consistent_float(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod,
):
    """Two parallel paths of different lengths feeding one successor --
    the longer path should be critical (zero float), the shorter one
    should show positive float, same shape as
    test_scheduling_cpm.py's own test_parallel_paths_only_longer_one_is_critical,
    just against a whole-day calendar -- confirms the backward pass
    (subtract_duration's whole-day branch) is internally consistent with
    the forward one, not just that the forward pass alone looks right."""
    await _anchor(db, live_schedule_period)
    cal = await _whole_day_calendar(client, project)
    long_path = await _create_activity(client, project, live_schedule_period, "Long", duration_hours=16, calendar_id=cal["id"])
    short_path = await _create_activity(client, project, live_schedule_period, "Short", duration_hours=8, calendar_id=cal["id"])
    joiner = await _create_activity(client, project, live_schedule_period, "Joiner", duration_hours=8, calendar_id=cal["id"])
    await _link(client, long_path, joiner)
    await _link(client, short_path, joiner)

    long_path = await _get(client, long_path["id"])
    short_path = await _get(client, short_path["id"])
    joiner = await _get(client, joiner["id"])
    assert long_path["is_critical"] is True
    assert float(long_path["total_float_hours"]) == 0.0
    assert short_path["is_critical"] is False
    assert float(short_path["total_float_hours"]) > 0.0
    assert joiner["is_critical"] is True
    # Every date in the whole network still lands on an envelope boundary.
    for a in (long_path, short_path, joiner):
        assert a["start"].endswith("T08:00:00")
        assert a["finish"].endswith("T16:00:00")


async def test_hour_precision_calendar_in_same_project_is_unaffected(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod,
):
    """Every calendar defaults to whole_day_scheduling=True now (2026-07-13,
    per Maro: "let it be whole day by default... i dont want that option" —
    removed as a UI toggle, but the field and the CPM engine's own
    conditional branch are both still real, see test_scheduling_cpm.py's own
    _use_hour_precision helper). A calendar explicitly opted back into
    hour-precision via a direct PATCH must not leak whole-day snapping from
    a sibling whole-day calendar in the same project -- mixed-calendar
    projects are an explicit, supported case (Calendar's own docstring)."""
    await _anchor(db, live_schedule_period)
    calendars = await client.get("/api/v1/calendars/", params={"project_id": str(project.id)})
    standard_id = calendars.json()[0]["id"]
    resp = await client.patch(f"/api/v1/calendars/{standard_id}", json={"whole_day_scheduling": False})
    assert resp.status_code == 200, resp.text
    await _whole_day_calendar(client, project)  # exists in the project, but not used below

    # 5h isn't a whole multiple of the 8h/day envelope -- hour-precision
    # finishes mid-day (08:00 + 4h to the 12:00 lunch break, +1 more hour
    # after it reopens at 13:00 -> 14:00); whole-day would instead round up
    # to a full extra day. A duration that happens to divide evenly
    # wouldn't actually distinguish the two modes.
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=5)
    assert a["start"] == "2025-06-02T08:00:00"
    assert a["finish"] == "2025-06-02T14:00:00"


async def test_whole_day_suspend_resume_skips_the_gap_by_whole_days(
    client: AsyncClient, db: AsyncSession, project: Project, live_schedule_period: SchedulePeriod,
):
    """An earlier version of the whole-day branch dropped suspend_date/
    resume_date entirely (caught by test_scheduling_cpm_suspend_resume.py
    once whole-day became every calendar's default) -- a suspended activity
    must still have its finish pushed out by the full gap, just in whole
    working days instead of minutes."""
    await _anchor(db, live_schedule_period)
    cal = await _whole_day_calendar(client, project)
    a = await _create_activity(client, project, live_schedule_period, "Excavation", duration_hours=24, calendar_id=cal["id"])
    assert a["finish"] == "2025-06-04T16:00:00"  # 3 whole days, Mon-Wed

    # Suspend on Wednesday (the 3rd, still-unconsumed day) through the
    # following Wednesday -- Wed/Thu/Fri and the following Mon/Tue all fall
    # inside the gap and must be skipped entirely.
    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={
        "suspend_date": "2025-06-04T08:00:00", "resume_date": "2025-06-11T08:00:00",
    })
    assert resp.status_code == 200, resp.text
    # Mon+Tue already consumed 2 of the 3 needed days; the 3rd now falls on
    # the first available day at/after resume -- Wednesday 11 June.
    assert resp.json()["finish"] == "2025-06-11T16:00:00"
