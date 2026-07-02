"""Pure time-window arithmetic shared by the CPM engine (app/services/scheduling_cpm.py)
and the calendar API response layer (app/services/calendar.py). No DB access here —
everything takes plain datetime.time values / Calendar-like objects and returns plain
values, so it's cheap to unit test and reuse from both places.

Phase 10 (hour-level CPM, 2026-07-02): a calendar's net working hours/day is no longer
a typed-in number — it's derived from the day envelope (day_start_time..day_end_time)
minus any recurring CalendarBreak spans (e.g. a daily lunch break). See
docs/SCHEDULING_MODULE_PLAN.md Phase 10.
"""
from __future__ import annotations

from datetime import date, time
from decimal import Decimal
from typing import Protocol


class _HasBreakTimes(Protocol):
    start_time: time
    end_time: time


def minutes_between(start: time, end: time) -> int:
    """Whole minutes from start to end, same calendar day. Negative/zero if end<=start."""
    return (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)


def add_minutes(t: time, minutes: int) -> time:
    total = t.hour * 60 + t.minute + minutes
    total = max(0, min(total, 24 * 60))
    return time(hour=min(total // 60, 23), minute=total % 60) if total < 24 * 60 else time(23, 59)


def merge_windows(windows: list[tuple[time, time]]) -> list[tuple[time, time]]:
    """Sort + merge overlapping/touching (start, end) windows into a minimal set."""
    cleaned = [(s, e) for s, e in windows if e > s]
    if not cleaned:
        return []
    ordered = sorted(cleaned, key=lambda w: w[0])
    merged = [ordered[0]]
    for s, e in ordered[1:]:
        last_s, last_e = merged[-1]
        if s <= last_e:
            merged[-1] = (last_s, max(last_e, e))
        else:
            merged.append((s, e))
    return merged


def subtract_window(windows: list[tuple[time, time]], remove_start: time, remove_end: time) -> list[tuple[time, time]]:
    """Remove [remove_start, remove_end) from every window in the list, splitting as needed."""
    result: list[tuple[time, time]] = []
    for s, e in windows:
        if remove_end <= s or remove_start >= e:
            result.append((s, e))
            continue
        if remove_start > s:
            result.append((s, remove_start))
        if remove_end < e:
            result.append((remove_end, e))
    return [w for w in result if w[1] > w[0]]


def compute_hours_per_day(day_start_time: time, day_end_time: time, breaks: list[_HasBreakTimes]) -> Decimal:
    """Net working hours in a normal (non-exception) working day on this calendar —
    the envelope minus every break's span. Used for display (Activity.duration_days)
    and for the calendar API response's computed hours_per_day field."""
    windows = [(day_start_time, day_end_time)]
    for b in breaks:
        windows = subtract_window(windows, b.start_time, b.end_time)
    total_minutes = sum(minutes_between(s, e) for s, e in windows)
    return Decimal(max(total_minutes, 0)) / 60


_WEEKDAY_FIELDS = [
    "works_monday", "works_tuesday", "works_wednesday", "works_thursday",
    "works_friday", "works_saturday", "works_sunday",
]


def day_windows(
    calendar,
    d: date,
    exceptions: list,
    breaks: list[_HasBreakTimes],
) -> list[tuple[time, time]]:
    """The working (start, end) time windows for one calendar day, after applying
    full-day exceptions, partial-day exceptions, and recurring breaks, in that order.

    Precedence: a full-day exception (start_time/end_time both null) replaces the
    whole day's base envelope outright (working -> non-working, or vice versa, e.g.
    a planned Saturday). Partial-day exceptions then carve into whatever's left —
    is_working=False removes a sub-window (e.g. "08:00-09:00 non-working" on one
    date), is_working=True adds one (e.g. two hours of exceptional weekend working).
    Breaks are subtracted last, from whatever windows remain, including on
    exception-added working days (a lunch break still applies).
    """
    is_normal_working_day = bool(getattr(calendar, _WEEKDAY_FIELDS[d.weekday()]))
    windows: list[tuple[time, time]] = [(calendar.day_start_time, calendar.day_end_time)] if is_normal_working_day else []

    day_exceptions = [ex for ex in exceptions if ex.start_date <= d <= ex.end_date]
    full_day = [ex for ex in day_exceptions if ex.start_time is None or ex.end_time is None]
    partial_day = [ex for ex in day_exceptions if ex.start_time is not None and ex.end_time is not None]

    if full_day:
        winning = full_day[-1]
        windows = [(calendar.day_start_time, calendar.day_end_time)] if winning.is_working else []

    for ex in partial_day:
        if ex.is_working:
            windows = merge_windows(windows + [(ex.start_time, ex.end_time)])
        else:
            windows = subtract_window(windows, ex.start_time, ex.end_time)

    for br in breaks:
        windows = subtract_window(windows, br.start_time, br.end_time)

    return windows
