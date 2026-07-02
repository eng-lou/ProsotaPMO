from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.services.scheduling_cpm import _cpm_participants

# DCMA 14-Point Assessment thresholds — a US Defense Contract Management Agency
# schedule-quality standard, not a PMI/PMBOK artifact (it doesn't appear anywhere in
# our PMBOK7/Rita Mulcahy reference material — see docs/SCHEDULING_MODULE_PLAN.md
# §B.6). Per Maro's confirmed decision, checks 1-12 are implemented; 13-14 (Critical
# Path Length Index, Baseline Execution Index) need longitudinal multi-period
# baseline-execution history to be meaningful and are deferred. Numbering/labels for
# checks 1-4, 6-9 match the prototype's own 8 example rows exactly; 5, 10, 11, 12 fill
# the gaps the prototype didn't demo, using the standard DCMA numbering — flagged for
# Maro to correct if his own practice numbers these differently.
#
# Phase 10 (hour-level CPM) made float/duration genuinely hour-precision fields. These
# thresholds stay in "working days" (the unit DCMA itself publishes them in) — checks
# 6/9 convert each activity's float/duration to days using a nominal 8h/day, rather
# than that activity's own resolved calendar's real hours/day, to avoid this module
# needing a full calendar lookup just for a threshold that's already a documented
# approximation, not a precise figure.
_NOMINAL_HOURS_PER_DAY = 8
HIGH_FLOAT_DAYS = 44
HIGH_DURATION_DAYS = 44

Status = Literal["pass", "warn", "fail", "na"]


def _pct(count: int, total: int) -> float:
    return round((count / total) * 100, 1) if total else 0.0


def _status_max(actual: float, threshold: float) -> Status:
    """actual should be <= threshold. threshold == 0 is a hard line (any violation
    fails outright, no warn band) — the other checks warn up to 2x threshold before
    failing. The 2x band is a reasonable interpretation, not a DCMA-published number."""
    if actual <= threshold:
        return "pass"
    if threshold == 0:
        return "fail"
    return "warn" if actual <= threshold * 2 else "fail"


async def compute_quality(db: AsyncSession, period_id: uuid.UUID) -> dict:
    activities_result = await db.execute(select(Activity).where(Activity.period_id == period_id))
    all_activities = list(activities_result.scalars().all())
    participants = _cpm_participants(all_activities)
    total = len(participants)
    participant_ids = {a.id for a in participants}

    rel_result = await db.execute(
        select(ActivityRelationship)
        .join(Activity, Activity.id == ActivityRelationship.predecessor_id)
        .where(Activity.period_id == period_id)
    )
    relationships = [
        r for r in rel_result.scalars().all()
        if r.predecessor_id in participant_ids and r.successor_id in participant_ids
    ]

    has_predecessor = {r.successor_id for r in relationships}
    has_successor = {r.predecessor_id for r in relationships}
    rel_total = len(relationships)

    missing_pred = sum(1 for a in participants if a.id not in has_predecessor)
    missing_succ = sum(1 for a in participants if a.id not in has_successor)
    non_fs = sum(1 for r in relationships if r.relationship_type != "FS")
    negative_lag = sum(1 for r in relationships if r.lag_hours < 0)
    positive_lag = sum(1 for r in relationships if r.lag_hours > 0)
    hard_constraints = sum(1 for a in participants if a.constraint_type == "ms")
    high_float = sum(
        1 for a in participants
        if a.total_float_hours is not None and a.total_float_hours / _NOMINAL_HOURS_PER_DAY > HIGH_FLOAT_DAYS
    )
    negative_float = sum(1 for a in participants if a.total_float_hours is not None and a.total_float_hours < 0)
    high_duration = sum(
        1 for a in participants
        if (a.duration_hours or 0) / _NOMINAL_HOURS_PER_DAY > HIGH_DURATION_DAYS
    )

    today = date.today()
    invalid_dates = sum(
        1 for a in participants
        if a.actual_finish is None and a.finish is not None and a.finish.date() < today
    )
    missed_tasks = sum(
        1 for a in participants
        if a.actual_finish is not None and a.bl_finish is not None and a.actual_finish > a.bl_finish
    )
    baselined_or_actual = sum(
        1 for a in participants if a.bl_finish is not None or a.actual_finish is not None
    )

    critical_path_pass, critical_path_detail = _critical_path_test(participants, relationships)

    checks = [
        {
            "number": 1, "name": "Missing Predecessors", "standard": "DCMA #1",
            "threshold_label": "<5%", "actual": _pct(missing_pred, total),
            "status": _status_max(_pct(missing_pred, total), 5.0),
        },
        {
            "number": 2, "name": "Missing Successors", "standard": "DCMA #2",
            "threshold_label": "<5%", "actual": _pct(missing_succ, total),
            "status": _status_max(_pct(missing_succ, total), 5.0),
        },
        {
            "number": 3, "name": "Relationship Types (non-FS)", "standard": "DCMA #3",
            "threshold_label": "<10%", "actual": _pct(non_fs, rel_total),
            "status": _status_max(_pct(non_fs, rel_total), 10.0),
        },
        {
            "number": 4, "name": "Positive Lags", "standard": "DCMA #4",
            "threshold_label": "<5%", "actual": _pct(positive_lag, rel_total),
            "status": _status_max(_pct(positive_lag, rel_total), 5.0),
        },
        {
            "number": 5, "name": "Leads (Negative Lag)", "standard": "DCMA #5",
            "threshold_label": "0%", "actual": _pct(negative_lag, rel_total),
            "status": _status_max(_pct(negative_lag, rel_total), 0.0),
        },
        {
            "number": 6, "name": "High Float (>44 working days)", "standard": "DCMA #6",
            "threshold_label": "<5%", "actual": _pct(high_float, total),
            "status": _status_max(_pct(high_float, total), 5.0),
        },
        {
            "number": 7, "name": "Negative Float", "standard": "DCMA #7",
            "threshold_label": "0%", "actual": _pct(negative_float, total),
            "status": _status_max(_pct(negative_float, total), 0.0),
        },
        {
            "number": 8, "name": "Hard Constraints", "standard": "DCMA #8",
            "threshold_label": "<5%", "actual": _pct(hard_constraints, total),
            "status": _status_max(_pct(hard_constraints, total), 5.0),
        },
        {
            "number": 9, "name": "Durations >44 working days", "standard": "DCMA #9",
            "threshold_label": "<5%", "actual": _pct(high_duration, total),
            "status": _status_max(_pct(high_duration, total), 5.0),
        },
        {
            "number": 10, "name": "Invalid Dates", "standard": "DCMA #10",
            "threshold_label": "0%", "actual": _pct(invalid_dates, total),
            "status": _status_max(_pct(invalid_dates, total), 0.0),
        },
        {
            "number": 11, "name": "Missed Tasks", "standard": "DCMA #11",
            "threshold_label": "<5%", "actual": _pct(missed_tasks, baselined_or_actual),
            "status": _status_max(_pct(missed_tasks, baselined_or_actual), 5.0) if baselined_or_actual else "na",
        },
        {
            "number": 12, "name": "Critical Path Test", "standard": "DCMA #12",
            "threshold_label": "unbroken chain", "actual": critical_path_detail,
            "status": "pass" if critical_path_pass else ("na" if critical_path_detail == "no critical path" else "fail"),
        },
    ]

    logic_score = _pct(total * 2 - missing_pred - missing_succ, total * 2) if total else 0.0

    return {
        "period_id": period_id,
        "activity_count": total,
        "logic_score": logic_score,
        "checks": checks,
    }


def _critical_path_test(
    participants: list[Activity], relationships: list[ActivityRelationship]
) -> tuple[bool, str]:
    """DCMA #12: the critical path must be one continuous, traceable chain — not
    fragments. Checked here as: every critical activity (except one at each end of
    the chain) must have at least one critical predecessor AND at least one critical
    successor among *its own* relationships. A critical activity with no critical
    neighbour on one side is a break in the chain.
    """
    critical = [a for a in participants if a.is_critical]
    if not critical:
        return True, "no critical path"
    critical_ids = {a.id for a in critical}

    critical_preds: dict[uuid.UUID, int] = {a.id: 0 for a in critical}
    critical_succs: dict[uuid.UUID, int] = {a.id: 0 for a in critical}
    for r in relationships:
        if r.predecessor_id in critical_ids and r.successor_id in critical_ids:
            critical_succs[r.predecessor_id] += 1
            critical_preds[r.successor_id] += 1

    no_critical_pred = [a for a in critical if critical_preds[a.id] == 0]
    no_critical_succ = [a for a in critical if critical_succs[a.id] == 0]
    # A single, connected chain has exactly one "start" (no critical predecessor) and
    # one "end" (no critical successor). More than one of either means the critical
    # path is fragmented into multiple disconnected pieces.
    if len(no_critical_pred) <= 1 and len(no_critical_succ) <= 1:
        return True, f"{len(critical)} critical activities, one continuous chain"
    return False, f"{len(critical)} critical activities, fragmented into multiple chains"
