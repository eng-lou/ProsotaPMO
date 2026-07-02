from __future__ import annotations

import uuid
from collections import defaultdict, deque
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.calendar import Calendar, CalendarException
from app.models.period import Period
from app.services import calendar as calendar_service

_WEEKDAY_FIELDS = [
    "works_monday", "works_tuesday", "works_wednesday", "works_thursday",
    "works_friday", "works_saturday", "works_sunday",
]


class _CalendarLookup:
    """Resolves an activity's effective calendar (its own override, or the
    project's default) and answers working-day questions against it. Per
    Maro's confirmed spec: whole project can sit on one calendar while
    individual activities override onto another."""

    def __init__(self, calendars: list[Calendar], exceptions: list[CalendarException]):
        self._by_id = {c.id: c for c in calendars}
        self._default = next((c for c in calendars if c.is_project_default), None)
        self._exceptions: dict[uuid.UUID, list[CalendarException]] = defaultdict(list)
        for ex in exceptions:
            self._exceptions[ex.calendar_id].append(ex)

    def resolve(self, activity: Activity) -> Calendar:
        if activity.calendar_id is not None and activity.calendar_id in self._by_id:
            return self._by_id[activity.calendar_id]
        if self._default is not None:
            return self._default
        raise HTTPException(status_code=422, detail="Project has no default calendar")

    def is_working_day(self, calendar: Calendar, d: date) -> bool:
        for ex in self._exceptions.get(calendar.id, []):
            if ex.start_date <= d <= ex.end_date:
                return ex.is_working
        return bool(getattr(calendar, _WEEKDAY_FIELDS[d.weekday()]))

    def snap_forward(self, calendar: Calendar, d: date) -> date:
        while not self.is_working_day(calendar, d):
            d += timedelta(days=1)
        return d

    def snap_backward(self, calendar: Calendar, d: date) -> date:
        while not self.is_working_day(calendar, d):
            d -= timedelta(days=1)
        return d

    def offset(self, calendar: Calendar, d: date, n: int) -> date:
        """Move n working days away from d (not counting d itself). n=0 is a no-op."""
        step = 1 if n >= 0 else -1
        remaining = abs(n)
        cur = d
        while remaining > 0:
            cur += timedelta(days=step)
            if self.is_working_day(calendar, cur):
                remaining -= 1
        return cur

    def add_duration(self, calendar: Calendar, start: date, duration_days: int) -> date:
        """Finish date for an activity of duration_days starting on start (duration
        counts inclusively — a 1-day task starting and finishing the same day)."""
        start = self.snap_forward(calendar, start)
        if duration_days <= 1:
            return start
        return self.offset(calendar, start, duration_days - 1)

    def subtract_duration(self, calendar: Calendar, finish: date, duration_days: int) -> date:
        finish = self.snap_backward(calendar, finish)
        if duration_days <= 1:
            return finish
        return self.offset(calendar, finish, -(duration_days - 1))

    def working_days_between(self, calendar: Calendar, a: date, b: date) -> int:
        """Signed working-day count from a to b, per this calendar. 0 if equal."""
        if a == b:
            return 0
        sign = 1 if b > a else -1
        lo, hi = (a, b) if b > a else (b, a)
        count = 0
        d = lo
        while d < hi:
            d += timedelta(days=1)
            if self.is_working_day(calendar, d):
                count += 1
        return sign * count


def _cpm_participants(activities: list[Activity]) -> list[Activity]:
    # WBS summary rows are rollups from children (app/services/activity.py:
    # _recompute_hierarchy), not part of the CPM network — deliberately excluded
    # here rather than given a fake float value.
    return [a for a in activities if a.activity_type in ("task", "milestone")]


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
    lookup: _CalendarLookup, calendar: Calendar, rel_type: str, lag_days: int,
    pred_es: date, pred_ef: date, duration_days: int,
) -> date:
    if rel_type == "SS":
        return lookup.offset(calendar, pred_es, lag_days)
    if rel_type == "FF":
        required_ef = lookup.offset(calendar, pred_ef, lag_days)
        return lookup.subtract_duration(calendar, required_ef, duration_days)
    if rel_type == "SF":
        required_ef = lookup.offset(calendar, pred_es, lag_days)
        return lookup.subtract_duration(calendar, required_ef, duration_days)
    # FS (default/most common, per PMBOK7 Ch.8): successor starts the next working
    # day after the predecessor finishes, shifted further by lag (or pulled earlier
    # by a negative lag/lead, allowing overlap).
    return lookup.offset(calendar, pred_ef, 1 + lag_days)


def _relationship_lf_candidate(
    lookup: _CalendarLookup, calendar: Calendar, rel_type: str, lag_days: int,
    succ_ls: date, succ_lf: date, duration_days: int,
) -> date:
    if rel_type == "SS":
        required_ls = lookup.offset(calendar, succ_ls, -lag_days)
        return lookup.add_duration(calendar, required_ls, duration_days)
    if rel_type == "FF":
        return lookup.offset(calendar, succ_lf, -lag_days)
    if rel_type == "SF":
        required_ls = lookup.offset(calendar, succ_lf, -lag_days)
        return lookup.add_duration(calendar, required_ls, duration_days)
    return lookup.offset(calendar, succ_ls, -(1 + lag_days))


async def recompute_schedule(db: AsyncSession, period_id: uuid.UUID) -> None:
    """Forward/backward pass (PMBOK7/Rita Mulcahy Ch.8) over a period's activities.

    Writes back start/finish/total_float/free_float/is_critical — these become
    genuinely computed from duration+logic+calendar+constraints from here on,
    never accepted as API input (docs/SCHEDULING_MODULE_PLAN.md Phase 5). Runs
    on-demand after any activity/relationship mutation rather than on every read.
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
            a.total_float = None
            a.free_float = None
            a.is_critical = None

    if not participants:
        await db.commit()
        return

    # Reuses the lazy-seeding list — guarantees a default calendar exists rather than
    # duplicating that logic here (app/services/calendar.py:list_calendars).
    calendars = await calendar_service.list_calendars(db, project_id)
    exceptions_result = await db.execute(
        select(CalendarException).where(CalendarException.calendar_id.in_([c.id for c in calendars]))
    )
    exceptions = list(exceptions_result.scalars().all())
    lookup = _CalendarLookup(calendars, exceptions)

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

    anchor = period.start_date or date.today()
    es: dict[uuid.UUID, date] = {}
    ef: dict[uuid.UUID, date] = {}

    for a in order:
        calendar = lookup.resolve(a)
        duration = a.duration_days or 0

        preds = predecessors_of.get(a.id, [])
        if preds:
            candidate = max(
                _relationship_es_candidate(
                    lookup, calendar, r.relationship_type, r.lag_days,
                    es[r.predecessor_id], ef[r.predecessor_id], duration,
                )
                for r in preds
            )
        else:
            candidate = lookup.snap_forward(calendar, anchor)

        if a.constraint_type == "ms" and a.constraint_date is not None:
            activity_es = a.constraint_date
        elif a.constraint_type == "snet" and a.constraint_date is not None:
            activity_es = max(candidate, a.constraint_date)
        else:
            activity_es = candidate

        es[a.id] = activity_es
        ef[a.id] = lookup.add_duration(calendar, activity_es, duration)

    project_finish = max(ef.values())

    ls: dict[uuid.UUID, date] = {}
    lf: dict[uuid.UUID, date] = {}

    for a in reversed(order):
        calendar = lookup.resolve(a)
        duration = a.duration_days or 0

        succs = successors_of.get(a.id, [])
        if succs:
            candidate = min(
                _relationship_lf_candidate(
                    lookup, calendar, r.relationship_type, r.lag_days,
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
        a.total_float = lookup.working_days_between(calendar, es[a.id], ls[a.id])

        succs = successors_of.get(a.id, [])
        if not succs:
            a.free_float = a.total_float
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
                    bound = lookup.offset(calendar, es[succ.id], -r.lag_days)
                    free_candidates.append(lookup.working_days_between(calendar, es[a.id], bound))
                else:
                    bound = lookup.offset(calendar, es[succ.id], -(1 + r.lag_days))
                    free_candidates.append(lookup.working_days_between(calendar, ef[a.id], bound))
            a.free_float = max(0, min(free_candidates)) if free_candidates else a.total_float

        a.is_critical = a.total_float <= 0
        # Same formula as app/services/activity.py:_apply_computed_fields — re-derived
        # here too since CPM is what just set (possibly changed) this activity's finish.
        a.variance_days = (a.finish - a.bl_finish).days if a.bl_finish is not None else None

    await db.commit()
    for a in all_activities:
        await db.refresh(a)
