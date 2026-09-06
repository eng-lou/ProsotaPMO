from __future__ import annotations

import uuid
from collections import defaultdict, deque
from datetime import date, datetime, time, timedelta
from decimal import ROUND_CEILING, Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.calendar import Calendar, CalendarBreak, CalendarException
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_variant import ScheduleVariant
from app.models.schedule_subproject import ScheduleSubproject
from app.schemas.activity import is_milestone_type
from app.services import calendar as calendar_service
from app.services.calendar_time import compute_hours_per_day, day_windows

# Safety bound for the day-by-day walks below (snap/add/subtract/working-hours) — a
# calendar with genuinely zero working time ever (e.g. every weekday unchecked) would
# otherwise loop forever; ~10 years of days is far beyond any realistic schedule.
_MAX_DAY_STEPS = 3650


def data_date_for_period(period: SchedulePeriod) -> date:
    """The schedule's "data date" — the anchor the forward pass schedules from
    (below), and the same reference point Planned Value prorates against (see
    app/services/cost_element.py:_schedule_evm). Reschedule
    (app/services/scheduling_reschedule.py) moves period.start_date; PV must
    track that, not the real wall-clock date, or "data date" stops meaning
    anything the moment it's moved. Falls back to today only when a period has
    never been anchored (start_date still null)."""
    return period.start_date or date.today()


def data_date_time_for_period(period: SchedulePeriod, default_day_start: time) -> datetime:
    """Full datetime version of data_date_for_period, for the (now
    hour-precision — see elapsed_duration_fraction) Schedule % Complete / PV
    proration callers. period.start_time is the exact instant Reschedule's
    "set data date directly" mode may have pinned (app/services/
    scheduling_reschedule.py:set_data_date); default_day_start is the
    caller's already-resolved fallback (each read path picks its own — e.g.
    the project's default calendar's day_start_time) for when it's null."""
    return datetime.combine(data_date_for_period(period), period.start_time or default_day_start)


async def default_day_start_times(db: AsyncSession, project_ids: set[uuid.UUID]) -> dict[uuid.UUID, time]:
    """Batched {project_id: day_start_time} for whichever calendar is that
    project's default — the fallback data_date_time_for_period needs when a
    period has no explicit start_time. A project with no calendar rows yet
    (never touched the Calendar widget) falls back to time(8, 0), matching
    Calendar's own column default (app/models/calendar.py) rather than
    triggering that widget's lazy-seed side effect from this read path."""
    if not project_ids:
        return {}
    result = await db.execute(
        select(Calendar.project_id, Calendar.day_start_time).where(
            Calendar.project_id.in_(project_ids), Calendar.is_project_default.is_(True)
        )
    )
    return {row.project_id: row.day_start_time for row in result.all()}


def _count_working_days(lookup: "_CalendarLookup", calendar: Calendar, d1: date, d2: date) -> int:
    """Inclusive count of the calendar's own working days in [d1, d2] — the
    unit elapsed_duration_fraction below prorates against. Bounded the same
    way every other day-by-day walk in this file is (_MAX_DAY_STEPS) —
    unreachable in practice (a real activity's own start-finish span is
    never anywhere near 10 years), just a hard backstop against a
    pathological input looping forever."""
    if d2 < d1:
        return 0
    count = 0
    d = d1
    for _ in range(_MAX_DAY_STEPS):
        if d > d2:
            break
        if lookup.is_working_day(calendar, d):
            count += 1
        d += timedelta(days=1)
    return count


def elapsed_duration_fraction(
    lookup: "_CalendarLookup", calendar: Calendar,
    start: datetime | None, finish: datetime | None, data_date: datetime,
) -> Decimal | None:
    """What fraction (0-1) of a [start, finish] span has elapsed as of the
    data date — "Schedule % Complete" (renamed from "Duration % Complete"
    2026-09-03, per Maro: that name read as a comment on the activity's own
    duration, not the time-elapsed-vs-data-date calculation it actually is
    — see app/schemas/activity.py's own schedule_pct_complete field for the
    full story), distinct from the manually-assessed Physical % Complete
    (Activity.pct_complete) that drives Earned Value. This is the exact
    input Planned Value prorates against (see
    app/services/cost_element.py:_schedule_evm) — extracted here so both PV
    and the "Schedule % Complete" figure shown directly on the activity (a
    transparency aid, per Maro) can never drift apart. None if there's no
    span to measure (no start/finish at all).

    start/finish should be the activity's BASELINE dates when one has been
    captured, live/current dates otherwise (2026-09-06, per Maro — every
    caller already resolves this; see app/services/activity.py:
    _attach_evm_fields and app/services/cost_element.py:_linked_activity_dates
    for the real comparison that settled it: checked against a genuine
    P6-exported EVM table for four real in-progress activities at once, live
    dates matched none of them, baseline dates matched three exactly and the
    fourth within a point).

    Working-day proration (2026-09-04, per Maro — real, exact P6
    interoperability: "it needs to be the exact match or Prosota loses
    complete credibility"), not calendar-time proration — confirmed against
    a real P6 export's own reported PV to 5 decimal places (14 working days
    elapsed of 18 working days total = 0.77778 exactly, matching P6's own
    ratio; the previous calendar-second-based version gave 0.80672 for the
    identical start/finish/data-date, since it counted weekends as elapsed
    time and P6 doesn't). Both counts are whole working DAYS via the
    activity's own resolved calendar, not hour-precision.

    Whole-datetime edge cases (start==finish, data_date outside the span)
    are still resolved before ever counting a single day."""
    if start is None or finish is None:
        return None
    if finish <= start:
        return Decimal(1) if data_date >= finish else Decimal(0)
    if data_date <= start:
        return Decimal(0)
    if data_date >= finish:
        return Decimal(1)
    total_days = _count_working_days(lookup, calendar, start.date(), finish.date())
    if total_days <= 0:
        return Decimal(0)
    elapsed_days = _count_working_days(lookup, calendar, start.date(), data_date.date())
    return Decimal(elapsed_days) / Decimal(total_days)


def _exclude_suspend_window(
    interval_start: datetime, interval_end: datetime,
    suspend_date: datetime | None, resume_date: datetime | None,
) -> list[tuple[datetime, datetime]]:
    """Splits [interval_start, interval_end) around an activity's own
    suspend/resume gap (docs/SCHEDULING_GAPS_PLAN.md Phase 11 follow-up,
    2026-07-07, per Maro: "the remaining duration and planned finish need to
    regenerate skipping that period of inactivity") — the gap consumes no
    duration even if it falls on an otherwise-working calendar window.
    Returns the interval unchanged if there's no overlap, or with the gap
    carved out (as 0-2 sub-intervals) if there is."""
    if suspend_date is None or resume_date is None or interval_end <= suspend_date or interval_start >= resume_date:
        return [(interval_start, interval_end)]
    pieces: list[tuple[datetime, datetime]] = []
    if interval_start < suspend_date:
        pieces.append((interval_start, suspend_date))
    if interval_end > resume_date:
        pieces.append((resume_date, interval_end))
    return pieces


class _CalendarLookup:
    """Resolves an activity's effective calendar (its own override, or the project's
    default) and answers hour-precision working-time questions against it — Phase 10
    (2026-07-02) rewrite of the Phase 4/5 day-granularity version. Per Maro's confirmed
    spec: whole project can sit on one calendar while individual activities override
    onto another.
    """

    def __init__(self, calendars: list[Calendar], exceptions: list[CalendarException], breaks: list[CalendarBreak]):
        self._by_id = {c.id: c for c in calendars}
        self._default = next((c for c in calendars if c.is_project_default), None)
        self._exceptions: dict[uuid.UUID, list[CalendarException]] = defaultdict(list)
        for ex in exceptions:
            self._exceptions[ex.calendar_id].append(ex)
        self._breaks: dict[uuid.UUID, list[CalendarBreak]] = defaultdict(list)
        for br in breaks:
            self._breaks[br.calendar_id].append(br)
        self._window_cache: dict[tuple[uuid.UUID, date], list[tuple[time, time]]] = {}

    def resolve(self, activity: Activity) -> Calendar:
        return self.resolve_calendar_id(activity.calendar_id)

    def resolve_calendar_id(self, calendar_id: uuid.UUID | None) -> Calendar:
        """Same fallback-to-project-default resolution as resolve(), just not
        tied to an Activity — used by Resource Tracking (app/services/
        resource_assignment_spread.py) to resolve a *Resource's* own optional
        calendar the same way."""
        if calendar_id is not None and calendar_id in self._by_id:
            return self._by_id[calendar_id]
        if self._default is not None:
            return self._default
        raise HTTPException(status_code=422, detail="Project has no default calendar")

    def is_working_day(self, calendar: Calendar, d: date) -> bool:
        return bool(self._windows(calendar, d))

    def hours_per_day(self, calendar: Calendar) -> Decimal:
        return compute_hours_per_day(calendar.day_start_time, calendar.day_end_time, self._breaks.get(calendar.id, []))

    def _windows(self, calendar: Calendar, d: date) -> list[tuple[time, time]]:
        key = (calendar.id, d)
        cached = self._window_cache.get(key)
        if cached is None:
            cached = day_windows(calendar, d, self._exceptions.get(calendar.id, []), self._breaks.get(calendar.id, []))
            self._window_cache[key] = cached
        return cached

    def is_working_instant(self, calendar: Calendar, dt: datetime) -> bool:
        t = dt.time()
        return any(s <= t < e for s, e in self._windows(calendar, dt.date()))

    def snap_forward(self, calendar: Calendar, dt: datetime) -> datetime:
        """The earliest working instant at or after dt."""
        for _ in range(_MAX_DAY_STEPS):
            windows = self._windows(calendar, dt.date())
            t = dt.time()
            for s, e in windows:
                if t < s:
                    return datetime.combine(dt.date(), s)
                if s <= t < e:
                    return dt
            dt = datetime.combine(dt.date() + timedelta(days=1), time.min)
        raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

    def snap_backward(self, calendar: Calendar, dt: datetime) -> datetime:
        """The latest working instant at or before dt."""
        for _ in range(_MAX_DAY_STEPS):
            windows = self._windows(calendar, dt.date())
            t = dt.time()
            for s, e in reversed(windows):
                if t > e:
                    return datetime.combine(dt.date(), e)
                if s < t <= e:
                    return dt
                if t == s:
                    return dt
            dt = datetime.combine(dt.date() - timedelta(days=1), time(23, 59))
        raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

    def finish_from_start(
        self, calendar: Calendar, es: datetime, duration_hours: Decimal,
        suspend_date: datetime | None = None, resume_date: datetime | None = None,
    ) -> datetime:
        """An activity's own EF given its own ES and duration — distinct from
        add_duration itself specifically for the zero-duration (milestone)
        case: add_duration always snap_forwards its start first (needed when
        duration_hours is a real lag/lead being applied to a *start*-type
        anchor, add_duration's other caller via offset_hours), but a
        milestone consumes no time at all, so its ES — however it was
        derived, including possibly landing exactly at a working day's close
        via an FF/SF relationship — IS its EF, with no re-snap. Re-snapping
        it as add_duration(es, 0) would do could bump a Finish Milestone a
        full day later than its own driving predecessor's real finish (found
        2026-07-07, per Maro — see _relationship_es_candidate's own FF
        comment for the matching forward-pass half of this same bug).

        suspend_date/resume_date (docs/SCHEDULING_GAPS_PLAN.md Phase 11
        follow-up, 2026-07-07, per Maro: "the remaining duration and planned
        finish need to regenerate skipping that period of inactivity") — see
        add_duration."""
        if duration_hours <= 0:
            return es
        return self.add_duration(calendar, es, duration_hours, suspend_date, resume_date)

    def add_duration(
        self, calendar: Calendar, start: datetime, duration_hours: Decimal,
        suspend_date: datetime | None = None, resume_date: datetime | None = None,
    ) -> datetime:
        """The instant duration_hours of working time after start (used both for a
        task's own EF-from-ES, and — via offset_hours — for applying a lag/lead).

        suspend_date/resume_date carve that window out of the walk entirely —
        no duration is consumed inside it even on an otherwise-working day, so
        an activity suspended mid-flight has its Finish pushed out by the full
        gap once it resumes, rather than the gap silently overlapping its
        planned working time.

        Whole-day calendars (calendar.whole_day_scheduling, 2026-07-13 per
        Maro) skip the minute-level walk below — see _add_duration_whole_day
        — but still honour suspend_date/resume_date: a whole day is either
        fully available or fully skipped (whole-day mode has no concept of
        a partial day either way), rather than dropping the gap entirely
        (an earlier version of this branch ignored suspend/resume outright,
        caught by test_scheduling_cpm_suspend_resume.py once whole-day
        became every calendar's own default)."""
        if calendar.whole_day_scheduling:
            return self._add_duration_whole_day(calendar, start, duration_hours, suspend_date, resume_date)
        cur = self.snap_forward(calendar, start)
        if duration_hours <= 0:
            return cur
        remaining_minutes = int(round(duration_hours * 60))
        for _ in range(_MAX_DAY_STEPS):
            windows = self._windows(calendar, cur.date())
            t = cur.time()
            for s, e in windows:
                if t >= e:
                    continue
                window_start_dt = datetime.combine(cur.date(), max(t, s))
                window_end_dt = datetime.combine(cur.date(), e)
                for sub_start, sub_end in _exclude_suspend_window(window_start_dt, window_end_dt, suspend_date, resume_date):
                    avail_minutes = int((sub_end - sub_start).total_seconds() // 60)
                    if avail_minutes <= 0:
                        continue
                    if avail_minutes >= remaining_minutes:
                        return sub_start + timedelta(minutes=remaining_minutes)
                    remaining_minutes -= avail_minutes
            cur = datetime.combine(cur.date() + timedelta(days=1), time.min)
        raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

    def subtract_duration(
        self, calendar: Calendar, finish: datetime, duration_hours: Decimal,
        suspend_date: datetime | None = None, resume_date: datetime | None = None,
    ) -> datetime:
        """The instant duration_hours of working time before finish (the backward-pass
        mirror of add_duration) — same suspend_date/resume_date carve-out, and
        the same whole-day-calendar branch (_subtract_duration_whole_day)."""
        if calendar.whole_day_scheduling:
            return self._subtract_duration_whole_day(calendar, finish, duration_hours, suspend_date, resume_date)
        cur = self.snap_backward(calendar, finish)
        if duration_hours <= 0:
            return cur
        remaining_minutes = int(round(duration_hours * 60))
        for _ in range(_MAX_DAY_STEPS):
            windows = self._windows(calendar, cur.date())
            t = cur.time()
            for s, e in reversed(windows):
                if t <= s:
                    continue
                window_start_dt = datetime.combine(cur.date(), s)
                window_end_dt = datetime.combine(cur.date(), min(t, e))
                for sub_start, sub_end in reversed(_exclude_suspend_window(window_start_dt, window_end_dt, suspend_date, resume_date)):
                    avail_minutes = int((sub_end - sub_start).total_seconds() // 60)
                    if avail_minutes <= 0:
                        continue
                    if avail_minutes >= remaining_minutes:
                        return sub_end - timedelta(minutes=remaining_minutes)
                    remaining_minutes -= avail_minutes
            cur = datetime.combine(cur.date() - timedelta(days=1), time(23, 59))
        raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

    def _is_available_whole_day(
        self, calendar: Calendar, d: date, suspend_date: datetime | None, resume_date: datetime | None,
    ) -> bool:
        """A working day that's also NOT wholly-or-partly inside a
        suspend/resume gap — whole-day mode has no notion of a partial day,
        so any overlap at all (not just a full-day overlap) takes the whole
        day out of consideration, unlike the hour-precision path's own
        _exclude_suspend_window, which carves out only the overlapping
        minutes."""
        if not self.is_working_day(calendar, d):
            return False
        if suspend_date is None or resume_date is None:
            return True
        day_start = datetime.combine(d, calendar.day_start_time)
        day_end = datetime.combine(d, calendar.day_end_time)
        return day_end <= suspend_date or day_start >= resume_date

    def _add_duration_whole_day(
        self, calendar: Calendar, start: datetime, duration_hours: Decimal,
        suspend_date: datetime | None = None, resume_date: datetime | None = None,
    ) -> datetime:
        """add_duration's whole-day-calendar branch (2026-07-13, per Maro:
        "there are activities starting by 16:30 one day and ending 11:00
        another even though i set the calendar... ensure the generated
        activities use it" — traced the hour-precision math as correct, but
        Maro wants day-only granularity instead). Every result lands on
        exactly day_start_time or day_end_time, never mid-day.

        `start`'s own day counts as "already spent" (push to the next
        working day) whenever its time-of-day is past day_start_time — e.g.
        a predecessor on a different, hour-precision calendar finished mid-
        afternoon, or a lag pushed past the morning; a fresh whole day is
        needed regardless of how much of *this* day would technically still
        be free. Otherwise this day itself is the first of the days
        consumed below."""
        cur_date = start.date()
        if start.time() > calendar.day_start_time:
            cur_date += timedelta(days=1)
        for _ in range(_MAX_DAY_STEPS):
            if self._is_available_whole_day(calendar, cur_date, suspend_date, resume_date):
                break
            cur_date += timedelta(days=1)
        else:
            raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

        if duration_hours <= 0:
            return datetime.combine(cur_date, calendar.day_start_time)

        hours_per_day = self.hours_per_day(calendar)
        if hours_per_day <= 0:
            raise HTTPException(status_code=422, detail="Calendar has no working hours in a day")
        # Rounds up — a whole-day calendar has no concept of a partial day,
        # so any nonzero remainder still occupies a full extra day (same
        # rule a lag/lead inherits automatically via offset_hours, since it
        # also routes through this method).
        days_needed = int((duration_hours / hours_per_day).to_integral_value(rounding=ROUND_CEILING))
        days_needed = max(days_needed, 1)

        remaining = days_needed
        for _ in range(_MAX_DAY_STEPS):
            if self._is_available_whole_day(calendar, cur_date, suspend_date, resume_date):
                remaining -= 1
                if remaining == 0:
                    return datetime.combine(cur_date, calendar.day_end_time)
            cur_date += timedelta(days=1)
        raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

    def _subtract_duration_whole_day(
        self, calendar: Calendar, finish: datetime, duration_hours: Decimal,
        suspend_date: datetime | None = None, resume_date: datetime | None = None,
    ) -> datetime:
        """subtract_duration's whole-day-calendar branch — the exact backward
        mirror of _add_duration_whole_day (own docstring has the full
        rationale)."""
        cur_date = finish.date()
        if finish.time() < calendar.day_end_time:
            cur_date -= timedelta(days=1)
        for _ in range(_MAX_DAY_STEPS):
            if self._is_available_whole_day(calendar, cur_date, suspend_date, resume_date):
                break
            cur_date -= timedelta(days=1)
        else:
            raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

        if duration_hours <= 0:
            return datetime.combine(cur_date, calendar.day_end_time)

        hours_per_day = self.hours_per_day(calendar)
        if hours_per_day <= 0:
            raise HTTPException(status_code=422, detail="Calendar has no working hours in a day")
        days_needed = int((duration_hours / hours_per_day).to_integral_value(rounding=ROUND_CEILING))
        days_needed = max(days_needed, 1)

        remaining = days_needed
        for _ in range(_MAX_DAY_STEPS):
            if self._is_available_whole_day(calendar, cur_date, suspend_date, resume_date):
                remaining -= 1
                if remaining == 0:
                    return datetime.combine(cur_date, calendar.day_start_time)
            cur_date -= timedelta(days=1)
        raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

    def offset_hours(self, calendar: Calendar, dt: datetime, hours: Decimal) -> datetime:
        """Move dt by signed working hours — the lag/lead application used throughout
        the forward/backward pass. Positive moves forward (a lag/wait); negative moves
        backward (a lead/overlap). hours=0 snaps dt to the next working instant if it
        isn't already one — e.g. an FS successor at zero lag starts the moment its
        predecessor finishes, or the next working instant after that if the
        predecessor's finish landed at/after a day's working envelope closes.

        Whole-day calendars get their own branch (2026-07-13), not
        add_duration/subtract_duration directly: this method's result is
        always fed onward as a *start*-type candidate (its own docstring —
        "successor starts the moment its predecessor finishes"), so it must
        always land on day_start_time. add_duration/subtract_duration's
        whole-day branches intentionally do the opposite (day_end_time/
        day_start_time respectively) because *they* are answering "what's
        the finish of N hours of real work" — a genuinely different
        question from "what's the next available start after waiting N
        hours." Conflating the two here originally sent a 2-hour lag
        through add_duration's finish-producing whole-day math and got back
        a same-day 16:00 instead of the intended next-whole-day 08:00 —
        caught by this file's own test_scheduling_cpm_whole_day.py."""
        if calendar.whole_day_scheduling:
            return self._offset_hours_whole_day(calendar, dt, hours)
        if hours >= 0:
            return self.add_duration(calendar, dt, hours)
        return self.subtract_duration(calendar, dt, -hours)

    def _offset_hours_whole_day(self, calendar: Calendar, dt: datetime, hours: Decimal) -> datetime:
        cur_date = dt.date()
        if dt.time() > calendar.day_start_time:
            cur_date += timedelta(days=1)
        for _ in range(_MAX_DAY_STEPS):
            if self.is_working_day(calendar, cur_date):
                break
            cur_date += timedelta(days=1)
        else:
            raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

        if hours == 0:
            return datetime.combine(cur_date, calendar.day_start_time)

        hours_per_day = self.hours_per_day(calendar)
        if hours_per_day <= 0:
            raise HTTPException(status_code=422, detail="Calendar has no working hours in a day")
        extra_days = int((abs(hours) / hours_per_day).to_integral_value(rounding=ROUND_CEILING))
        extra_days = max(extra_days, 1)
        step = timedelta(days=1) if hours > 0 else -timedelta(days=1)
        remaining = extra_days
        for _ in range(_MAX_DAY_STEPS):
            cur_date += step
            if self.is_working_day(calendar, cur_date):
                remaining -= 1
                if remaining == 0:
                    return datetime.combine(cur_date, calendar.day_start_time)
        raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

    def working_hours_between(self, calendar: Calendar, a: datetime, b: datetime) -> Decimal:
        """Signed working-hour count from a to b. 0 if equal.

        Quantized to 2 decimal places — matching total_float_hours/
        free_float_hours/duration_hours's actual Numeric(7,2) column precision
        — since a plain minutes/60 division can produce a long repeating
        decimal (e.g. 485 minutes = 8.08333...). Postgres itself rounds to 2dp
        on every write, so this was previously only ever "corrected" by
        whichever caller happened to re-fetch the row from the DB afterward;
        quantizing at the source means the in-memory value is already correct
        even when nothing refreshes it (found as a real inconsistency,
        2026-07-04, once refreshes stopped happening unconditionally for
        performance — see recompute_schedule's dirty-tracking below)."""
        if a == b:
            return Decimal("0.00")
        sign = 1 if b > a else -1
        lo, hi = (a, b) if b > a else (b, a)
        total_minutes = 0
        d = lo.date()
        while d <= hi.date():
            windows = self._windows(calendar, d)
            day_lo = lo if d == lo.date() else datetime.combine(d, time.min)
            day_hi = hi if d == hi.date() else datetime.combine(d, time(23, 59))
            for s, e in windows:
                w_start, w_end = datetime.combine(d, s), datetime.combine(d, e)
                overlap_start, overlap_end = max(w_start, day_lo), min(w_end, day_hi)
                if overlap_end > overlap_start:
                    total_minutes += int((overlap_end - overlap_start).total_seconds() // 60)
            d += timedelta(days=1)
        return (sign * Decimal(total_minutes) / 60).quantize(Decimal("0.01"))


def _cpm_participants(activities: list[Activity]) -> list[Activity]:
    # WBS summary rows are rollups from children (app/services/activity.py:
    # _recompute_hierarchy), not part of the CPM network — deliberately excluded
    # here rather than given a fake float value. Archived activities (2026-07-04,
    # per Maro's archive system) are parked/done and forced to 100% complete —
    # also excluded, the same way, rather than let a dead task keep driving or
    # being driven by the live network's critical path.
    return [a for a in activities if (a.activity_type == "task" or is_milestone_type(a.activity_type)) and not a.is_archived]


async def get_project_finish(db: AsyncSession, schedule_period_id: uuid.UUID) -> datetime | None:
    """The project finish date is, by definition, the latest computed finish among
    the CPM network's participants — used by app/services/scheduling_reschedule.py
    for a real before/after impact figure rather than a mocked-up number."""
    result = await db.execute(select(Activity).where(Activity.schedule_period_id == schedule_period_id))
    participants = _cpm_participants(list(result.scalars().all()))
    finishes = [a.finish for a in participants if a.finish is not None]
    return max(finishes) if finishes else None


def _find_cycle(edges: list[tuple[uuid.UUID, uuid.UUID]], node_ids: set[uuid.UUID]) -> bool:
    """DFS three-colour cycle check over predecessor->successor edges."""
    graph: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for pred, succ in edges:
        graph[pred].append(succ)

    WHITE, GRAY, BLACK = 0, 1, 2
    colour = {n: WHITE for n in node_ids}

    def visit(node: uuid.UUID) -> bool:
        colour[node] = GRAY
        for nxt in graph.get(node, []):
            if colour.get(nxt, WHITE) == GRAY:
                return True
            if colour.get(nxt, WHITE) == WHITE and visit(nxt):
                return True
        colour[node] = BLACK
        return False

    return any(colour[n] == WHITE and visit(n) for n in node_ids)


# Same DFS as _find_cycle above, but returns the actual loop (as a list of
# node ids, first==last) instead of a bare bool (2026-07-21, per Maro — a
# real "circular dependency" rejection against a real, large generated
# schedule with no way to tell which of its ~200 relationships were
# actually involved). schedule_bulk_generate.py's own per-edge validation
# loop still calls _find_cycle for the bool fast-path on every candidate
# edge (unchanged, still O(1) extra work per edge) — this only ever runs
# once, after that check has already found a cycle, purely to turn "which
# edge" into an answer instead of a guess.
def _find_cycle_path(edges: list[tuple[uuid.UUID, uuid.UUID]], node_ids: set[uuid.UUID]) -> list[uuid.UUID] | None:
    graph: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for pred, succ in edges:
        graph[pred].append(succ)

    WHITE, GRAY, BLACK = 0, 1, 2
    colour = {n: WHITE for n in node_ids}
    stack: list[uuid.UUID] = []

    def visit(node: uuid.UUID) -> list[uuid.UUID] | None:
        colour[node] = GRAY
        stack.append(node)
        for nxt in graph.get(node, []):
            if colour.get(nxt, WHITE) == GRAY:
                return stack[stack.index(nxt):] + [nxt]
            if colour.get(nxt, WHITE) == WHITE:
                found = visit(nxt)
                if found is not None:
                    return found
        colour[node] = BLACK
        stack.pop()
        return None

    for n in node_ids:
        if colour[n] == WHITE:
            found = visit(n)
            if found is not None:
                return found
    return None


async def would_create_cycle(
    db: AsyncSession, schedule_period_id: uuid.UUID, predecessor_id: uuid.UUID, successor_id: uuid.UUID
) -> bool:
    """Full multi-hop check used at relationship-creation time — Phase 3 only rejected
    the direct reverse of an existing link; this catches longer cycles (A->B->C->A)."""
    result = await db.execute(
        select(ActivityRelationship)
        .join(Activity, Activity.id == ActivityRelationship.predecessor_id)
        .where(Activity.schedule_period_id == schedule_period_id)
    )
    edges = [(r.predecessor_id, r.successor_id) for r in result.scalars().all()]
    edges.append((predecessor_id, successor_id))
    node_ids = {n for edge in edges for n in edge}
    return _find_cycle(edges, node_ids)


def _topological_order(activities: list[Activity], edges: list[tuple[uuid.UUID, uuid.UUID]]) -> list[Activity]:
    by_id = {a.id: a for a in activities}
    in_degree = {a.id: 0 for a in activities}
    graph: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for pred, succ in edges:
        if pred in by_id and succ in by_id:
            graph[pred].append(succ)
            in_degree[succ] += 1

    queue = deque(sorted((a.id for a in activities if in_degree[a.id] == 0), key=lambda i: str(i)))
    ordered: list[Activity] = []
    while queue:
        node_id = queue.popleft()
        ordered.append(by_id[node_id])
        for nxt in graph.get(node_id, []):
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                queue.append(nxt)

    # A leftover cycle (shouldn't happen — would_create_cycle blocks it at the source)
    # is handled defensively: append whatever wasn't reached so recompute still runs
    # for the rest of the network instead of silently dropping activities.
    if len(ordered) != len(activities):
        seen = {a.id for a in ordered}
        ordered.extend(a for a in activities if a.id not in seen)
    return ordered


def _relationship_es_candidate(
    lookup: _CalendarLookup, calendar: Calendar, rel_type: str, lag_hours: Decimal,
    pred_es: datetime, pred_ef: datetime, duration_hours: Decimal,
    suspend_date: datetime | None = None, resume_date: datetime | None = None,
) -> datetime:
    if rel_type == "SS":
        return lookup.offset_hours(calendar, pred_es, lag_hours)
    if rel_type == "FF":
        # At zero lag, the successor's required finish is simply pred_ef
        # itself — routing that through offset_hours (as every other branch
        # here does) would be wrong specifically for FF: pred_ef can
        # legitimately sit exactly at a working day's close (e.g. 17:00),
        # which offset_hours' snap-forward (built for turning a *finish* into
        # the next *start* instant, per its own docstring — exactly what FS
        # below wants) would incorrectly bump to the next working day, one
        # full day later than the predecessor actually finished (found
        # 2026-07-07, per Maro: a Finish Milestone linked FF was showing a
        # day later than its later-finishing FF predecessor). A genuine
        # nonzero lag does need to walk forward that many working hours from
        # pred_ef, which legitimately starts counting from the next working
        # instant if pred_ef itself has none left in its own day.
        required_ef = pred_ef if lag_hours == 0 else lookup.offset_hours(calendar, pred_ef, lag_hours)
        return lookup.subtract_duration(calendar, required_ef, duration_hours, suspend_date, resume_date)
    if rel_type == "SF":
        required_ef = lookup.offset_hours(calendar, pred_es, lag_hours)
        return lookup.subtract_duration(calendar, required_ef, duration_hours, suspend_date, resume_date)
    # FS (default/most common, per PMBOK7 Ch.8): successor can start the moment the
    # predecessor finishes (no artificial "+1 day" — Phase 10's hour precision makes
    # that day-granularity proxy unnecessary; if the finish instant itself isn't
    # working time, offset_hours' zero-lag snap-forward naturally rolls to the next
    # working instant), shifted further by lag (or pulled earlier by a lead).
    return lookup.offset_hours(calendar, pred_ef, lag_hours)


def _relationship_lf_candidate(
    lookup: _CalendarLookup, calendar: Calendar, rel_type: str, lag_hours: Decimal,
    succ_ls: datetime, succ_lf: datetime, duration_hours: Decimal,
    suspend_date: datetime | None = None, resume_date: datetime | None = None,
) -> datetime:
    if rel_type == "SS":
        required_ls = lookup.offset_hours(calendar, succ_ls, -lag_hours)
        return lookup.add_duration(calendar, required_ls, duration_hours, suspend_date, resume_date)
    if rel_type == "FF":
        # Same zero-lag asymmetry as the forward pass's own FF branch above,
        # mirrored: succ_lf is a finish-type value that can legitimately sit
        # exactly at a working day's close, so it must not be routed through
        # offset_hours' snap-forward at zero lag (offset_hours(-0) still
        # takes the ">=0" add_duration branch, since -Decimal("0.00") == 0).
        return succ_lf if lag_hours == 0 else lookup.offset_hours(calendar, succ_lf, -lag_hours)
    if rel_type == "SF":
        required_ls = succ_lf if lag_hours == 0 else lookup.offset_hours(calendar, succ_lf, -lag_hours)
        return lookup.add_duration(calendar, required_ls, duration_hours, suspend_date, resume_date)
    return lookup.offset_hours(calendar, succ_ls, -lag_hours)


async def _build_calendar_lookup(db: AsyncSession, project_id: uuid.UUID) -> _CalendarLookup:
    # Reuses the lazy-seeding list — guarantees a default calendar exists rather than
    # duplicating that logic here (app/services/calendar.py:list_calendars).
    calendars = await calendar_service.list_calendars(db, project_id)
    exceptions_result = await db.execute(
        select(CalendarException).where(CalendarException.calendar_id.in_([c.id for c in calendars]))
    )
    exceptions = list(exceptions_result.scalars().all())
    breaks_result = await db.execute(
        select(CalendarBreak).where(CalendarBreak.calendar_id.in_([c.id for c in calendars]))
    )
    breaks = list(breaks_result.scalars().all())
    return _CalendarLookup(calendars, exceptions, breaks)


async def compute_duration_for_finish(db: AsyncSession, activity: Activity, target_finish: datetime) -> Decimal:
    """Translates a manually-typed Finish into the duration that produces it, given
    the activity's current computed Start — matching P6/Microsoft Project's own
    convention: editing Finish changes Duration (Start stays put), whereas editing
    Start applies a Mandatory Start constraint instead (handled directly in
    app/services/activity.py:update_activity — Start is never accepted as literal
    input here). Finish itself is still never stored directly; it stays fully
    CPM-computed from whatever duration this resolves to.
    """
    if activity.start is None:
        raise HTTPException(
            status_code=422,
            detail="This activity has no computed start yet — give it a duration or link it into the schedule first.",
        )
    if target_finish < activity.start:
        raise HTTPException(status_code=422, detail="Finish cannot be before Start.")
    lookup = await _build_calendar_lookup(db, activity.project_id)
    calendar = lookup.resolve(activity)
    return lookup.working_hours_between(calendar, activity.start, target_finish)


async def _recompute_subproject_floats(
    db: AsyncSession,
    project_id: uuid.UUID,
    all_activities: list[Activity],
    relationships: list[ActivityRelationship],
    lookup: _CalendarLookup,
    anchor: datetime,
    master_dirty_ids: set[uuid.UUID],
    force_all: bool = False,
) -> set[uuid.UUID]:
    """Second, additional float calculation per PM-tagged sub-project branch
    (2026-07-05, per Maro — docs/SUBPROJECT_FLOAT_PLAN.md, private docs repo).
    Never touches start/finish/total_float_hours/is_critical — those stay the
    master pass's alone. Writes only sub_total_float_hours/sub_is_critical,
    reusing the exact same forward/backward algorithm and calendar-aware
    arithmetic as the master pass above, just re-run on a smaller
    activity/relationship set per branch.

    Runs one lightweight query (below) even for a project that has never
    used this feature — everything after that is a pure in-memory no-op in
    that case (see the empty-`subprojects` early return), not an extra
    per-project-forever cost worth avoiding further.

    Returns the set of activity ids this function itself wrote to (cleared
    or freshly computed) — NOT derived from a second `db.is_modified()`
    sweep in the caller, because the `db.execute()` below autoflushes the
    master pass's own pending changes, which resets SQLAlchemy's dirty
    tracking for them; a later `is_modified()` check would then wrongly
    see the master pass's changes as already-clean and skip refreshing
    them, leaving expired attributes that blow up on response
    serialization. The caller unions this return value with the
    `master_dirty_ids` it captured *before* calling this function instead.
    """
    touched: set[uuid.UUID] = set()
    subprojects_result = await db.execute(
        select(ScheduleSubproject).where(ScheduleSubproject.project_id == project_id)
    )
    subprojects = list(subprojects_result.scalars().all())

    by_id = {a.id: a for a in all_activities}
    children: dict[uuid.UUID, list[Activity]] = defaultdict(list)
    for a in all_activities:
        if a.parent_id is not None:
            children[a.parent_id].append(a)

    def subtree_ids(root_id: uuid.UUID) -> set[uuid.UUID]:
        ids = {root_id}

        def visit(node_id: uuid.UUID) -> None:
            for child in children.get(node_id, []):
                ids.add(child.id)
                visit(child.id)

        visit(root_id)
        return ids

    # Every activity anywhere under any tagged branch, regardless of nesting —
    # anything *outside* all of these must have its sub-float cleared (covers
    # untagging, or an activity being moved out of a branch entirely). This
    # sweep is cheap (a set-membership check per activity, no DB/CPM work) and
    # runs even with zero subprojects, specifically so untagging the very last
    # one still clears its branch's stale numbers rather than leaving them
    # frozen at whatever they last were.
    all_branch_ids: set[uuid.UUID] = set()
    for sp in subprojects:
        all_branch_ids |= subtree_ids(sp.root_wbs_id)
    for a in all_activities:
        if a.id not in all_branch_ids and (a.sub_total_float_hours is not None or a.sub_is_critical is not None):
            a.sub_total_float_hours = None
            a.sub_is_critical = None
            touched.add(a.id)

    if not subprojects:
        return touched

    root_ids = {sp.root_wbs_id for sp in subprojects}

    def nearest_owner(activity: Activity) -> uuid.UUID | None:
        # Walks up parent_id to the *first* (nearest) ancestor that's itself
        # some sub-project's root — the branch that "owns" this activity's
        # stored sub-float when branches nest (docs/SUBPROJECT_FLOAT_PLAN.md
        # §D.1: a sub-project can sit inside another sub-project's own
        # subtree, e.g. individual delivery packages nested inside a larger
        # "Enabling Works" package).
        current = activity
        while current.parent_id is not None:
            if current.parent_id in root_ids:
                return current.parent_id
            parent = by_id.get(current.parent_id)
            if parent is None:
                return None
            current = parent
        return None

    owner_of: dict[uuid.UUID, uuid.UUID | None] = {}

    # Anything this specific call touched — a branch whose activities/
    # relationships are all untouched can't have a different scoped float
    # than it already has, so its pass is skipped entirely. Bounds the added
    # cost to "how many tagged ancestors does the edited activity have"
    # (small — a handful of nesting levels at most), not "how many
    # sub-projects exist in the whole project" (potentially many unrelated
    # packages) — see the plan doc's §D.2.
    touched_ids = set(master_dirty_ids)
    for obj in db.new | db.deleted:
        if isinstance(obj, ActivityRelationship):
            touched_ids.add(obj.predecessor_id)
            touched_ids.add(obj.successor_id)

    for sp in subprojects:
        branch_ids = subtree_ids(sp.root_wbs_id)
        if not force_all and branch_ids.isdisjoint(touched_ids):
            continue

        branch_participants = _cpm_participants([a for a in all_activities if a.id in branch_ids])
        if not branch_participants:
            continue
        branch_participant_ids = {a.id for a in branch_participants}
        # Internal relationships only — a link crossing the branch's own
        # boundary is dropped entirely, not partially honoured (§B/§D of the
        # plan doc: this is a structural, in-isolation float, not "how much
        # of the master schedule's slack this branch was actually given").
        branch_relationships = [
            r for r in relationships
            if r.predecessor_id in branch_participant_ids and r.successor_id in branch_participant_ids
        ]
        branch_edges = [(r.predecessor_id, r.successor_id) for r in branch_relationships]

        branch_predecessors_of: dict[uuid.UUID, list[ActivityRelationship]] = defaultdict(list)
        branch_successors_of: dict[uuid.UUID, list[ActivityRelationship]] = defaultdict(list)
        for r in branch_relationships:
            branch_predecessors_of[r.successor_id].append(r)
            branch_successors_of[r.predecessor_id].append(r)

        branch_order = _topological_order(branch_participants, branch_edges)

        b_es: dict[uuid.UUID, datetime] = {}
        b_ef: dict[uuid.UUID, datetime] = {}
        for a in branch_order:
            calendar = lookup.resolve(a)
            duration = a.duration_hours or Decimal(0)
            preds = branch_predecessors_of.get(a.id, [])
            if preds:
                candidate = max(
                    _relationship_es_candidate(
                        lookup, calendar, r.relationship_type, r.lag_hours,
                        b_es[r.predecessor_id], b_ef[r.predecessor_id], duration,
                        a.suspend_date, a.resume_date,
                    )
                    for r in preds
                )
            else:
                candidate = lookup.snap_forward(calendar, anchor)
            candidate = max(candidate, lookup.snap_forward(calendar, anchor))
            # mf (Mandatory Finish, 2026-07-07) pins EF exactly, ignoring
            # predecessor logic entirely — the finish-side mirror of ms
            # (Mandatory Start) just below, which already does the same to
            # ES. ES is then derived backward from the pinned EF, same
            # direction the rest of this loop derives EF forward from ES.
            if a.constraint_type == "mf" and a.constraint_date is not None:
                activity_ef = a.constraint_date
                activity_es = lookup.subtract_duration(calendar, activity_ef, duration, a.suspend_date, a.resume_date)
            else:
                if a.constraint_type == "ms" and a.constraint_date is not None:
                    activity_es = a.constraint_date
                elif a.constraint_type == "snet" and a.constraint_date is not None:
                    activity_es = max(candidate, a.constraint_date)
                else:
                    activity_es = candidate
                activity_ef = lookup.finish_from_start(calendar, activity_es, duration, a.suspend_date, a.resume_date)
                # fnet — see the master pass's own comment on this same check.
                if a.constraint_type == "fnet" and a.constraint_date is not None:
                    activity_ef = max(activity_ef, a.constraint_date)
            b_es[a.id] = activity_es
            b_ef[a.id] = activity_ef

        # Same "latest-finishing activity in the network" anchor logic the
        # master pass uses (line ~531 above), just scoped down to this
        # branch — no separate anchor concept invented (plan doc §D step 5).
        branch_finish = max(b_ef.values())

        b_ls: dict[uuid.UUID, datetime] = {}
        b_lf: dict[uuid.UUID, datetime] = {}
        for a in reversed(branch_order):
            calendar = lookup.resolve(a)
            duration = a.duration_hours or Decimal(0)
            succs = branch_successors_of.get(a.id, [])
            if succs:
                candidate = min(
                    _relationship_lf_candidate(
                        lookup, calendar, r.relationship_type, r.lag_hours,
                        b_ls[r.successor_id], b_lf[r.successor_id], duration,
                        a.suspend_date, a.resume_date,
                    )
                    for r in succs
                )
            else:
                candidate = branch_finish
            if a.constraint_type == "fnlt" and a.constraint_date is not None:
                activity_lf = min(candidate, a.constraint_date)
            else:
                activity_lf = candidate
            b_lf[a.id] = activity_lf
            branch_ls = lookup.subtract_duration(calendar, activity_lf, duration, a.suspend_date, a.resume_date)
            # snlt — see the master pass's own comment on this same check.
            if a.constraint_type == "snlt" and a.constraint_date is not None:
                branch_ls = min(branch_ls, a.constraint_date)
            b_ls[a.id] = branch_ls

        for a in branch_participants:
            if a.id not in owner_of:
                owner_of[a.id] = nearest_owner(a)
            if owner_of[a.id] != sp.root_wbs_id:
                # A more deeply nested sub-project owns this activity's
                # stored sub-float instead — this pass still needed to run
                # over it (above) for *this* branch's own internal network
                # to be correct, it just doesn't get to write here.
                continue
            calendar = lookup.resolve(a)
            a.sub_total_float_hours = lookup.working_hours_between(calendar, b_es[a.id], b_ls[a.id])
            a.sub_is_critical = a.sub_total_float_hours <= 0
            touched.add(a.id)

    return touched


async def recompute_schedule(
    db: AsyncSession, schedule_period_id: uuid.UUID, *, force_all_subprojects: bool = False,
    pinned_start_by_id: dict[uuid.UUID, datetime] | None = None,
    pinned_finish_by_id: dict[uuid.UUID, datetime] | None = None,
) -> None:
    """Forward/backward pass (PMBOK7/Rita Mulcahy Ch.8) over a period's activities.

    Writes back start/finish/duration_days/total_float_hours/free_float_hours/
    is_critical — these become genuinely computed from duration+logic+calendar+
    constraints from here on, never accepted as API input
    (docs/SCHEDULING_MODULE_PLAN.md Phase 5, retrofitted to hour precision in Phase
    10). Runs on-demand after any activity/relationship mutation rather than on
    every read.

    force_all_subprojects: set by app/services/schedule_subproject.py after
    tagging/retagging a branch — that action alone doesn't dirty any Activity
    or ActivityRelationship row, so the normal touched-set skip in
    _recompute_subproject_floats (§D.2) would otherwise wrongly skip the very
    branch that just needs its first-ever (or nesting-changed) scoped pass.

    pinned_start_by_id/pinned_finish_by_id: p6_import.py's own escape hatch for
    the small set of activities CPM genuinely cannot derive correctly on its
    own (2026-09-05, per Maro, tracing a real P6-vs-Prosota mismatch down to
    its actual root cause) — a real *In Progress* activity ("Third Floor
    Masonry Structure"): PhysicalPercentComplete 90% but DurationPercentComplete
    77.78%, meaning P6 has already re-projected its at-completion duration
    longer than the original PlannedDuration once real progress showed it
    running behind pace. Prosota's own finish_from_start has no way to
    reproduce that re-projection — it only knows the original planned
    duration — so it lands 2 real working days early. The file's own
    FinishDate is the one number that reflects P6's re-projection, so it's
    pinned directly into `ef` here, INSIDE this same forward pass, so a
    successor computed later in the same topological order
    ("Fourth Floor Slab") sees the corrected value and starts on or after it
    — earlier code applied this kind of correction in a separate pass *after*
    this whole function returned, which fixed the pinned activity's own
    display but never propagated to anything downstream of it (found via
    exactly that successor starting 2 real days before its own predecessor's
    corrected finish on a plain FS+0 link). Deliberately NOT extended to
    every activity: a follow-up real comparison ("Pergola and Amenities", 0%
    complete, no progress at all) found Prosota's own calendar math already
    landing bit-for-bit on P6's actual value (both correctly accounting for
    the calendar's own lunch break) while the file's own snapshot was stale
    by an hour — for genuinely not-yet-started, unconstrained work, trusting
    a frozen file value over a fresh, correct calendar+logic computation is
    the wrong default, not a safe one."""
    period = await db.get(SchedulePeriod, schedule_period_id)
    if period is None:
        return
    variant = await db.get(ScheduleVariant, period.schedule_variant_id)
    project_id = variant.project_id

    activities_result = await db.execute(select(Activity).where(Activity.schedule_period_id == schedule_period_id))
    all_activities = list(activities_result.scalars().all())
    participants = _cpm_participants(all_activities)
    participant_ids = {a.id for a in participants}

    for a in all_activities:
        if a.activity_type == "wbs_summary" or a.is_archived:
            a.total_float_hours = None
            a.free_float_hours = None
            a.is_critical = None
            a.sub_total_float_hours = None
            a.sub_is_critical = None

    if not participants:
        await db.commit()
        return

    lookup = await _build_calendar_lookup(db, project_id)

    rel_result = await db.execute(
        select(ActivityRelationship)
        .join(Activity, Activity.id == ActivityRelationship.predecessor_id)
        .where(Activity.schedule_period_id == schedule_period_id)
    )
    relationships = [
        r for r in rel_result.scalars().all()
        if r.predecessor_id in participant_ids and r.successor_id in participant_ids
    ]
    edges = [(r.predecessor_id, r.successor_id) for r in relationships]

    if _find_cycle(edges, participant_ids):
        # Shouldn't happen — would_create_cycle blocks this at relationship-creation
        # time — but don't leave the period's dates/float silently stale if it does.
        raise HTTPException(status_code=422, detail="Schedule logic contains a circular dependency")

    predecessors_of: dict[uuid.UUID, list[ActivityRelationship]] = defaultdict(list)
    successors_of: dict[uuid.UUID, list[ActivityRelationship]] = defaultdict(list)
    for r in relationships:
        predecessors_of[r.successor_id].append(r)
        successors_of[r.predecessor_id].append(r)

    order = _topological_order(participants, edges)
    by_id = {a.id: a for a in participants}

    anchor_date = data_date_for_period(period)
    default_calendar = lookup.resolve(participants[0])
    # period.start_time lets Reschedule's "set data date directly" mode pin an
    # exact time-of-day (2026-07-03, per Maro); null (the common case) falls
    # back to the calendar's own day start, as before.
    anchor = datetime.combine(anchor_date, period.start_time or default_calendar.day_start_time)
    es: dict[uuid.UUID, datetime] = {}
    ef: dict[uuid.UUID, datetime] = {}

    for a in order:
        calendar = lookup.resolve(a)
        duration = a.duration_hours or Decimal(0)

        # Per Maro's confirmed correction (P6 domain expertise): once an activity has
        # progress (% Complete > 0), its Start is a recorded fact — "it actually
        # started on that planned date" — not a forecast Reschedule/logic can move.
        # Finish stays anchored to the full planned duration regardless of progress
        # (a second, later correction from Maro overriding this block's original
        # design, which drove Finish off remaining_duration_hours instead — that
        # made Finish silently shrink the moment any progress was logged, collapsing
        # to literally equal Start at 100% complete, "disregarding the duration"
        # entirely). remaining_duration_hours (app/services/activity.py) stays a
        # purely informational display figure, never a scheduling input — logging
        # progress isn't evidence of finishing early, only an explicit Actual Finish
        # (a harder fact, handled below) or reaching the full planned span is.
        # actual_start IS also a separate CPM signal here (2026-09-04, per Maro
        # — real P6 comparison), not just redundant once % Complete > 0 exists
        # as originally reasoned: a genuinely-occurred P6 milestone can and
        # does report PercentComplete=0 regardless, signalling completion
        # purely via ActualStartDate/ActualFinishDate (confirmed against a
        # real file's own "Building Pad Delivered by Owner" — Start Milestone,
        # ActualStartDate = ActualFinishDate = its real 2010 date,
        # PercentComplete = 0). Without this, such a milestone's own status
        # also read "planned" (see _derive_activity_status's matching fix),
        # and this branch never fired for it either — it got rescheduled
        # forward to the data date as if not yet started at all, discarding
        # its real historical position entirely.
        has_progress = (a.pct_complete is not None and a.pct_complete > 0) or a.actual_start is not None
        if has_progress and a.start is not None:
            activity_es = a.start
            if a.actual_finish is not None:
                activity_ef = a.actual_finish
            else:
                activity_ef = lookup.finish_from_start(calendar, activity_es, duration, a.suspend_date, a.resume_date)
        else:
            preds = predecessors_of.get(a.id, [])
            if preds:
                candidate = max(
                    _relationship_es_candidate(
                        lookup, calendar, r.relationship_type, r.lag_hours,
                        es[r.predecessor_id], ef[r.predecessor_id], duration,
                        a.suspend_date, a.resume_date,
                    )
                    for r in preds
                )
            else:
                candidate = lookup.snap_forward(calendar, anchor)

            # Not-yet-started work can't be planned to start in the past relative to
            # the data date — Reschedule pulls it forward to the data date, same as
            # P6's "Apply Actuals/Reschedule," rather than silently leaving it
            # scheduled behind where the project has actually reached.
            candidate = max(candidate, lookup.snap_forward(calendar, anchor))

            # mf (Mandatory Finish, 2026-07-07) pins EF exactly, ignoring
            # predecessor logic entirely — the finish-side mirror of ms
            # (Mandatory Start) below, which already does the same to ES. ES
            # is then derived backward from the pinned EF, same direction the
            # rest of this branch derives EF forward from ES.
            if a.constraint_type == "mf" and a.constraint_date is not None:
                activity_ef = a.constraint_date
                activity_es = lookup.subtract_duration(calendar, activity_ef, duration, a.suspend_date, a.resume_date)
            else:
                if a.constraint_type == "ms" and a.constraint_date is not None:
                    activity_es = a.constraint_date
                elif a.constraint_type == "snet" and a.constraint_date is not None:
                    activity_es = max(candidate, a.constraint_date)
                else:
                    activity_es = candidate
                activity_ef = lookup.finish_from_start(calendar, activity_es, duration, a.suspend_date, a.resume_date)
                # fnet (Finish On or After, 2026-07-07) floors EF at the
                # constraint date without re-deriving ES backward from it
                # (unlike mf, which *pins* EF and re-derives ES) — ES stays
                # exactly where predecessor logic put it; this only says
                # "can't be considered finished before this date even if the
                # duration alone would land earlier," the finish-side mirror
                # of snet flooring ES above. A real forward push, same
                # category as snet/ms, not a float generator (see snlt below
                # for that half).
                if a.constraint_type == "fnet" and a.constraint_date is not None:
                    activity_ef = max(activity_ef, a.constraint_date)

        # Pins win over anything computed above, for this activity's own
        # es/ef AND for every later activity in this same topological pass
        # that reads es[a.id]/ef[a.id] as a predecessor position — see this
        # function's own docstring for why a pin is ever needed at all.
        if pinned_start_by_id is not None and a.id in pinned_start_by_id:
            activity_es = pinned_start_by_id[a.id]
        if pinned_finish_by_id is not None and a.id in pinned_finish_by_id:
            activity_ef = pinned_finish_by_id[a.id]

        es[a.id] = activity_es
        ef[a.id] = activity_ef

    project_finish = max(ef.values())

    ls: dict[uuid.UUID, datetime] = {}
    lf: dict[uuid.UUID, datetime] = {}

    for a in reversed(order):
        calendar = lookup.resolve(a)
        duration = a.duration_hours or Decimal(0)

        succs = successors_of.get(a.id, [])
        if succs:
            candidate = min(
                _relationship_lf_candidate(
                    lookup, calendar, r.relationship_type, r.lag_hours,
                    ls[r.successor_id], lf[r.successor_id], duration,
                    a.suspend_date, a.resume_date,
                )
                for r in succs
            )
        else:
            candidate = project_finish

        if a.constraint_type == "fnlt" and a.constraint_date is not None:
            activity_lf = min(candidate, a.constraint_date)
        else:
            activity_lf = candidate

        lf[a.id] = activity_lf
        activity_ls = lookup.subtract_duration(calendar, activity_lf, duration, a.suspend_date, a.resume_date)
        # snlt (Start On or Before, 2026-07-07) caps LS at the constraint
        # date — the start-side mirror of fnlt capping LF above. A soft
        # ceiling that can create negative float (if the forward-pass ES
        # this activity actually needs, from real predecessor logic, is
        # already later than the deadline) rather than moving anything —
        # the forward pass (es/ef, computed above) is untouched by it,
        # exactly as fnlt leaves the forward pass untouched.
        if a.constraint_type == "snlt" and a.constraint_date is not None:
            activity_ls = min(activity_ls, a.constraint_date)
        ls[a.id] = activity_ls

    for a in participants:
        calendar = lookup.resolve(a)
        # alap (As Late As Possible) no longer relocates the *displayed*
        # Start/Finish to Late Start/Late Finish (2026-09-05, per Maro,
        # reverting the 2026-07-07 design after a real P6 comparison: three
        # genuinely ALAP-constrained activities in a row — "Start Garage,"
        # "Shop Drawings, Review & Approval," "Fab & Delivery" — displayed
        # 8 months later in Prosota than in P6's own Activity Table for the
        # exact same file. P6 itself keeps an ALAP activity at its Early
        # dates for ordinary display; ALAP there mainly governs resource
        # leveling and float reporting, not the Start/Finish columns, and
        # only actually relocates an activity once you explicitly run
        # leveling — a feature Prosota doesn't have yet). total_float_hours
        # below (LS-ES) still reports the real slack ALAP earns it; only the
        # displayed position changed back to matching every other activity.
        a.start = es[a.id]
        a.finish = ef[a.id]
        hours_per_day = lookup.hours_per_day(calendar)
        # Quantized for the same reason working_hours_between is (above) — a
        # plain division can produce a long repeating decimal that only ever
        # got rounded away by a coincidental DB refresh.
        a.duration_days = (
            (a.duration_hours / hours_per_day).quantize(Decimal("0.01")) if a.duration_hours and hours_per_day > 0
            else (Decimal("0.00") if a.duration_hours == 0 else None)
        )
        a.total_float_hours = lookup.working_hours_between(calendar, es[a.id], ls[a.id])

        succs = successors_of.get(a.id, [])
        if not succs:
            a.free_float_hours = a.total_float_hours
        else:
            free_candidates = []
            for r in succs:
                succ = by_id[r.successor_id]
                # FS-dominant approximation (per Rita Mulcahy Ch.8, FS is "the most
                # commonly used relationship" and PMBOK's own free-float examples are
                # FS-only) — SS/FF/SF free float is directionally reasonable but not
                # rigorously derived for those types. Documented limitation, not an
                # oversight: a fully general free-float formula needs per-relationship-
                # type slack propagation that's out of scope for this pass.
                if r.relationship_type == "SS":
                    bound = lookup.offset_hours(calendar, es[succ.id], -r.lag_hours)
                    free_candidates.append(lookup.working_hours_between(calendar, es[a.id], bound))
                else:
                    bound = lookup.offset_hours(calendar, es[succ.id], -r.lag_hours)
                    free_candidates.append(lookup.working_hours_between(calendar, ef[a.id], bound))
            a.free_float_hours = max(Decimal(0), min(free_candidates)) if free_candidates else a.total_float_hours

        a.is_critical = a.total_float_hours <= 0
        # Same formula as app/services/activity.py:_apply_computed_fields — re-derived
        # here too since CPM is what just set (possibly changed) this activity's finish.
        a.variance_days = (a.finish - a.bl_finish).days if a.bl_finish is not None else None

    # Master pass's own dirty set, captured *before* the sub-project passes
    # below add their own writes — used only to decide which sub-project
    # branches actually need recomputing (a branch untouched by this specific
    # change can't have a different scoped float than it already has). The
    # master pass itself is completely unchanged above this line.
    master_dirty_ids = {a.id for a in all_activities if db.is_modified(a)}
    subproject_dirty_ids = await _recompute_subproject_floats(
        db, project_id, all_activities, relationships, lookup, anchor, master_dirty_ids,
        force_all=force_all_subprojects,
    )

    # Refresh only the rows this pass actually changed — captured before commit
    # clears SQLAlchemy's dirty-tracking. Same fix as app/services/activity.py:
    # _recompute_hierarchy — unconditionally refreshing *every* activity in the
    # period (rather than just the ones whose dates/float genuinely moved) was
    # a real, measured performance bug: one extra DB round trip per activity,
    # on every single create/update/delete, found at ~140-activity schedule
    # scale (2026-07-04 per Maro). Most edits (e.g. a commentary change) don't
    # shift anyone's computed dates, so this now refreshes close to nothing;
    # a duration/logic change that cascades still correctly refreshes everyone
    # it actually moved.
    #
    # dirty_ids is the union captured *before* _recompute_subproject_floats
    # ran, not a fresh `is_modified()` sweep here — that function's own query
    # autoflushes the master pass's pending changes, which would make a
    # second `is_modified()` check here wrongly see them as already-clean.
    dirty_ids = master_dirty_ids | subproject_dirty_ids
    await db.commit()
    for a in all_activities:
        if a.id in dirty_ids:
            await db.refresh(a)

    # Deferred import — resource_assignment_spread.py already imports
    # _build_calendar_lookup/_CalendarLookup from this module at load time,
    # so importing it back at module level here would be circular. See
    # prune_orphaned_spreads_for_activities' own header for why this needs
    # to run after every recompute, not just Resource Leveling's own writes.
    from app.services.resource_assignment_spread import prune_orphaned_spreads_for_activities
    await prune_orphaned_spreads_for_activities(db, dirty_ids)
