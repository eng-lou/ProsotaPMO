from __future__ import annotations

from datetime import date

# UK fiscal (tax) year: 6 April to 5 April the following year (2026-09-08,
# per Maro: "in the UK fiscal year is 6 April to 5 April of the following
# year"). Every function here is pure date math — no DB access — so the
# cost-side aggregation in cost_element.py:get_fy_breakdown can be tested
# against this independently of any project's real data.
_FY_START_MONTH = 4
_FY_START_DAY = 6


def fiscal_year_start_year(d: date) -> int:
    """The calendar year a UK fiscal year STARTS in, for whichever FY `d`
    falls inside — e.g. both 1 Sept 2010 and 1 Mar 2011 are inside the FY
    that starts 6 Apr 2010, so this returns 2010 for either."""
    if (d.month, d.day) >= (_FY_START_MONTH, _FY_START_DAY):
        return d.year
    return d.year - 1


def fiscal_year_label(start_year: int) -> str:
    """'FY10/11' for start_year=2010 — two-digit start/end calendar years,
    matching how Maro phrased every example ("FY 10/11"..."FY 14/15")."""
    return f"FY{start_year % 100:02d}/{(start_year + 1) % 100:02d}"


def fiscal_year_bounds(start_year: int) -> tuple[date, date]:
    """(6 Apr start_year, 5 Apr start_year+1) inclusive — the real calendar
    span of the FY that starts in `start_year`."""
    return date(start_year, _FY_START_MONTH, _FY_START_DAY), date(start_year + 1, _FY_START_MONTH, _FY_START_DAY - 1)


def fiscal_years_spanning(start: date, end: date) -> list[int]:
    """Every FY start_year touched by [start, end] inclusive, ascending —
    empty if start > end. Returns start_years, not labels, so callers can
    still do date-range math per year before formatting for display."""
    if start > end:
        return []
    return list(range(fiscal_year_start_year(start), fiscal_year_start_year(end) + 1))


def overlap_days(a_start: date, a_end: date, b_start: date, b_end: date) -> int:
    """Inclusive day-count overlap between [a_start, a_end] and
    [b_start, b_end] — 0 if they don't overlap. Used to weight how much of
    an activity's (or a project's remaining schedule's) duration falls
    inside one specific fiscal year, the same "spread evenly across
    calendar days" assumption already used elsewhere in this app (see
    dashboard.py:_kpis's own bottom-up EAC, "the assumption the activity's
    own cost accrues evenly across its duration")."""
    lo = max(a_start, b_start)
    hi = min(a_end, b_end)
    return (hi - lo).days + 1 if hi >= lo else 0
