from __future__ import annotations

import uuid
from decimal import Decimal

from app.models.activity import Activity
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.services.resource_costing import compute_assignment_budget, compute_assignment_rate_line_qty


def _resource(rate: str, resource_type: str = "labour") -> Resource:
    return Resource(id=uuid.uuid4(), project_id=uuid.uuid4(), resource_type=resource_type, name="Test", unit="day", rate=Decimal(rate))


def _activity(duration_hours: int, duration_days: str) -> Activity:
    # duration_days is set to whatever the *rounded* display value would be
    # (scheduling_cpm.py's own 2dp quantize) — deliberately different from
    # what duration_hours/hours_per_day gives at full precision, so a test
    # using the old formula and one using the new formula give visibly
    # different numbers, not coincidentally the same one.
    return Activity(id=uuid.uuid4(), duration_hours=Decimal(duration_hours), duration_days=Decimal(duration_days))


def test_budget_uses_exact_hours_per_day_not_rounded_duration_days():
    """2026-09-05, per Maro: "time is costed by the hour" — a real,
    quantified precision gap: activity.duration_days is a *display* field,
    deliberately rounded to 2dp (scheduling_cpm.py), but was also being fed
    straight into the money formula. 672 hours on a 9h/day calendar is
    74.6666...d, which the display field rounds to 74.67d — at £1000/day
    that rounding alone is worth ~£3.33 on this one activity. Passing the
    calendar's real hours_per_day must reproduce the *exact* figure, not
    the rounded one."""
    resource = _resource("1000")
    activity = _activity(duration_hours=672, duration_days="74.67")  # the rounded display value
    assignment = ResourceAssignment(id=uuid.uuid4(), activity_id=activity.id, resource_id=resource.id, utilisation_pct=Decimal(100))

    exact = compute_assignment_budget(resource, activity, assignment, Decimal(9))
    rounded_fallback = compute_assignment_budget(resource, activity, assignment)  # no hours_per_day given

    assert exact == (Decimal(672) / Decimal(9) * Decimal(1000)).quantize(Decimal("0.01"))
    assert rounded_fallback == Decimal("74670.00")  # 74.67 * 1000, the old (imprecise) behaviour
    assert exact != rounded_fallback
    assert abs(exact - rounded_fallback) > Decimal("3.00")


def test_rate_line_qty_matches_budget_exactly_with_the_same_hours_per_day():
    """The two functions' own shared contract (compute_assignment_rate_line_qty's
    own docstring: "qty x rate reproduces compute_assignment_budget exactly")
    — verified directly, since a caller passing hours_per_day to one but not
    the other would silently break it."""
    resource = _resource("1000")
    activity = _activity(duration_hours=672, duration_days="74.67")
    assignment = ResourceAssignment(id=uuid.uuid4(), activity_id=activity.id, resource_id=resource.id, utilisation_pct=Decimal(100))

    budget = compute_assignment_budget(resource, activity, assignment, Decimal(9))
    qty = compute_assignment_rate_line_qty(resource, activity, assignment, Decimal(9))
    assert (qty * resource.rate).quantize(Decimal("0.01")) == budget
