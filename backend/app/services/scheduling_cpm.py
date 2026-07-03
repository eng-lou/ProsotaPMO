from __future__ import annotations

import uuid
from collections import defaultdict, deque
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.calendar import Calendar, CalendarBreak, CalendarException
from app.models.period import Period
from app.services import calendar as calendar_service
from app.services.calendar_time import compute_hours_per_day, day_windows, minutes_between

# Safety bound for the day-by-day walks below (snap/add/subtract/working-hours) — a
# calendar with genuinely zero working time ever (e.g. every weekday unchecked) would
# otherwise loop forever; ~10 years of days is far beyond any realistic schedule.
_MAX_DAY_STEPS = 3650


def data_date_for_period(period: Period) -> date:
    """The schedule's "data date" — the anchor the forward pass schedules from
    (below), and the same reference point Planned Value prorates against (see
    app/services/cost_element.py:_schedule_evm). Reschedule
    (app/services/scheduling_reschedule.py) moves period.start_date; PV must
    track that, not the real wall-clock date, or "data date" stops meaning
    anything the moment it's moved. Falls back to today only when a period has
    never been anchored (start_date still null)."""
    return period.start_date or date.today()


def elapsed_duration_fraction(start: datetime | None, finish: datetime | None, data_date: date) -> Decimal | None:
    """What fraction (0-1) of an activity's own start-finish span has elapsed
    as of the data date — "Duration % Complete" in P6 terms, distinct from the
    manually-assessed Physical % Complete (Activity.pct_complete) that drives
    Earned Value. This is the exact input Planned Value prorates against (see
    app/services/cost_element.py:_schedule_evm) — extracted here so both PV and
    the "Duration % Complete" figure shown directly on the activity (a
    transparency aid, per Maro) can never drift apart. None if the activity
    isn't scheduled yet (no live start/finish)."""
    if start is None or finish is None:
        return None
    start_d, finish_d = start.date(), finish.date()
    if finish_d <= start_d:
        return Decimal(1) if data_date >= finish_d else Decimal(0)
    if data_date <= start_d:
        return Decimal(0)
    if data_date >= finish_d:
        return Decimal(1)
    return Decimal((data_date - start_d).days) / Decimal((finish_d - start_d).days)


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
        if activity.calendar_id is not None and activity.calendar_id in self._by_id:
            return self._by_id[activity.calendar_id]
        if self._default is not None:
            return self._default
        raise HTTPException(status_code=422, detail="Project has no default calendar")

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

    def add_duration(self, calendar: Calendar, start: datetime, duration_hours: Decimal) -> datetime:
        """The instant duration_hours of working time after start (used both for a
        task's own EF-from-ES, and — via offset_hours — for applying a lag/lead)."""
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
                window_start = max(t, s)
                avail_minutes = minutes_between(window_start, e)
                if avail_minutes >= remaining_minutes:
                    finish_minutes = window_start.hour * 60 + window_start.minute + remaining_minutes
                    return datetime.combine(cur.date(), time(finish_minutes // 60, finish_minutes % 60))
                remaining_minutes -= avail_minutes
            cur = datetime.combine(cur.date() + timedelta(days=1), time.min)
        raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

    def subtract_duration(self, calendar: Calendar, finish: datetime, duration_hours: Decimal) -> datetime:
        """The instant duration_hours of working time before finish (the backward-pass
        mirror of add_duration)."""
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
                window_end = min(t, e)
                avail_minutes = minutes_between(s, window_end)
                if avail_minutes >= remaining_minutes:
                    start_minutes = window_end.hour * 60 + window_end.minute - remaining_minutes
                    return datetime.combine(cur.date(), time(start_minutes // 60, start_minutes % 60))
                remaining_minutes -= avail_minutes
            cur = datetime.combine(cur.date() - timedelta(days=1), time(23, 59))
        raise HTTPException(status_code=422, detail="Calendar has no working time in the searched range")

    def offset_hours(self, calendar: Calendar, dt: datetime, hours: Decimal) -> datetime:
        """Move dt by signed working hours — the lag/lead application used throughout
        the forward/backward pass. Positive moves forward (a lag/wait); negative moves
        backward (a lead/overlap). hours=0 snaps dt to the next working instant if it
        isn't already one — e.g. an FS successor at zero lag starts the moment its
        predecessor finishes, or the next working instant after that if the
        predecessor's finish landed at/after a day's working envelope closes."""
        if hours >= 0:
            return self.add_duration(calendar, dt, hours)
        return self.subtract_duration(calendar, dt, -hours)

    def working_hours_between(self, calendar: Calendar, a: datetime, b: datetime) -> Decimal:
        """Signed working-hour count from a to b. 0 if equal."""
        if a == b:
            return Decimal(0)
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
        return sign * Decimal(total_minutes) / 60


def _cpm_participants(activities: list[Activity]) -> list[Activity]:
    # WBS summary rows are rollups from children (app/services/activity.py:
    # _recompute_hierarchy), not part of the CPM network — deliberately excluded
    # here rather than given a fake float value.
    return [a for a in activities if a.activity_type in ("task", "milestone")]


async def get_project_finish(db: AsyncSession, period_id: uuid.UUID) -> datetime | None:
    """The project finish date is, by definition, the latest computed finish among
    the CPM network's participants — used by app/services/scheduling_reschedule.py
    for a real before/after impact figure rather than a mocked-up number."""
    result = await db.execute(select(Activity).where(Activity.period_id == period_id))
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


async def would_create_cycle(
    db: AsyncSession, period_id: uuid.UUID, predecessor_id: uuid.UUID, successor_id: uuid.UUID
) -> bool:
    """Full multi-hop check used at relationship-creation time — Phase 3 only rejected
    the direct reverse of an existing link; this catches longer cycles (A->B->C->A)."""
    result = await db.execute(
        select(ActivityRelationship)
        .join(Activity, Activity.id == ActivityRelationship.predecessor_id)
        .where(Activity.period_id == period_id)
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
) -> datetime:
    if rel_type == "SS":
        return lookup.offset_hours(calendar, pred_es, lag_hours)
    if rel_type == "FF":
        required_ef = lookup.offset_hours(calendar, pred_ef, lag_hours)
        return lookup.subtract_duration(calendar, required_ef, duration_hours)
    if rel_type == "SF":
        required_ef = lookup.offset_hours(calendar, pred_es, lag_hours)
        return lookup.subtract_duration(calendar, required_ef, duration_hours)
    # FS (default/most common, per PMBOK7 Ch.8): successor can start the moment the
    # predecessor finishes (no artificial "+1 day" — Phase 10's hour precision makes
    # that day-granularity proxy unnecessary; if the finish instant itself isn't
    # working time, offset_hours' zero-lag snap-forward naturally rolls to the next
    # working instant), shifted further by lag (or pulled earlier by a lead).
    return lookup.offset_hours(calendar, pred_ef, lag_hours)


def _relationship_lf_candidate(
    lookup: _CalendarLookup, calendar: Calendar, rel_type: str, lag_hours: Decimal,
    succ_ls: datetime, succ_lf: datetime, duration_hours: Decimal,
) -> datetime:
    if rel_type == "SS":
        required_ls = lookup.offset_hours(calendar, succ_ls, -lag_hours)
        return lookup.add_duration(calendar, required_ls, duration_hours)
    if rel_type == "FF":
        return lookup.offset_hours(calendar, succ_lf, -lag_hours)
    if rel_type == "SF":
        required_ls = lookup.offset_hours(calendar, succ_lf, -lag_hours)
        return lookup.add_duration(calendar, required_ls, duration_hours)
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


async def recompute_schedule(db: AsyncSession, period_id: uuid.UUID) -> None:
    """Forward/backward pass (PMBOK7/Rita Mulcahy Ch.8) over a period's activities.

    Writes back start/finish/duration_days/total_float_hours/free_float_hours/
    is_critical — these become genuinely computed from duration+logic+calendar+
    constraints from here on, never accepted as API input
    (docs/SCHEDULING_MODULE_PLAN.md Phase 5, retrofitted to hour precision in Phase
    10). Runs on-demand after any activity/relationship mutation rather than on
    every read.
    """
    period = await db.get(Period, period_id)
    if period is None:
        return
    project_id = period.project_id

    activities_result = await db.execute(select(Activity).where(Activity.period_id == period_id))
    all_activities = list(activities_result.scalars().all())
    participants = _cpm_participants(all_activities)
    participant_ids = {a.id for a in participants}

    for a in all_activities:
        if a.activity_type == "wbs_summary":
            a.total_float_hours = None
            a.free_float_hours = None
            a.is_critical = None

    if not participants:
        await db.commit()
        return

    lookup = await _build_calendar_lookup(db, project_id)

    rel_result = await db.execute(
        select(ActivityRelationship)
        .join(Activity, Activity.id == ActivityRelationship.predecessor_id)
        .where(Activity.period_id == period_id)
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
    anchor = datetime.combine(anchor_date, default_calendar.day_start_time)
    es: dict[uuid.UUID, datetime] = {}
    ef: dict[uuid.UUID, datetime] = {}

    for a in order:
        calendar = lookup.resolve(a)
        duration = a.duration_hours or Decimal(0)

        # Per Maro's confirmed correction (P6 domain expertise): once an activity has
        # progress (% Complete > 0), its Start is a recorded fact — "it actually
        # started on that planned date" — not a forecast Reschedule/logic can move.
        # Only its Finish is still live, driven by what's actually left to do
        # (remaining_duration_hours, computed in app/services/activity.py from
        # duration x (1 - %complete)) rather than the original full duration.
        # actual_start is deliberately not a separate signal here — redundant once
        # % Complete > 0 exists, since the currently-stored start already IS the
        # date it started. actual_finish, if recorded, is a harder fact still (the
        # real finish), overriding the remaining-duration estimate entirely.
        has_progress = a.pct_complete is not None and a.pct_complete > 0
        if has_progress and a.start is not None:
            activity_es = a.start
            if a.actual_finish is not None:
                activity_ef = a.actual_finish
            else:
                remaining = a.remaining_duration_hours if a.remaining_duration_hours is not None else duration
                activity_ef = lookup.add_duration(calendar, activity_es, remaining)
        else:
            preds = predecessors_of.get(a.id, [])
            if preds:
                candidate = max(
                    _relationship_es_candidate(
                        lookup, calendar, r.relationship_type, r.lag_hours,
                        es[r.predecessor_id], ef[r.predecessor_id], duration,
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

            if a.constraint_type == "ms" and a.constraint_date is not None:
                activity_es = a.constraint_date
            elif a.constraint_type == "snet" and a.constraint_date is not None:
                activity_es = max(candidate, a.constraint_date)
            else:
                activity_es = candidate
            activity_ef = lookup.add_duration(calendar, activity_es, duration)

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
        ls[a.id] = lookup.subtract_duration(calendar, activity_lf, duration)

    for a in participants:
        calendar = lookup.resolve(a)
        a.start = es[a.id]
        a.finish = ef[a.id]
        hours_per_day = lookup.hours_per_day(calendar)
        a.duration_days = (a.duration_hours / hours_per_day) if a.duration_hours and hours_per_day > 0 else (
            Decimal(0) if a.duration_hours == 0 else None
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

    await db.commit()
    for a in all_activities:
        await db.refresh(a)
