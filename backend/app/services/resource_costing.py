"""Pure cost calculation for a resource assignment — shared by
app/services/resource_assignment.py (denormalized display) and
app/services/cost_sync.py (the Cost Plan sync total), so the two never drift
apart. See app/models/resource_assignment.py for the per-type formula."""
from __future__ import annotations

from decimal import Decimal

from app.models.activity import Activity
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment

_MONEY = Decimal("0.01")


def _exact_duration_days(activity: Activity | None, hours_per_day: Decimal | None) -> Decimal:
    """activity.duration_days itself is a *display* field, deliberately
    quantized to 2dp (scheduling_cpm.py) — real money should never be
    computed from an already-rounded intermediate. duration_hours /
    hours_per_day at full precision, computed fresh here, is what
    compute_assignment_budget/compute_assignment_rate_line_qty actually need
    (2026-09-05, per Maro: "time is costed by the hour" — a 673h activity on
    a 9h/day calendar is 74.7777...d, not the displayed 74.78d; at a
    £1000/day rate that 2dp rounding alone is worth ~£3 on this one
    activity, real money once summed across a whole schedule). Falls back to
    the rounded duration_days when hours_per_day isn't available (a caller
    with no calendar context handy) — strictly better than nothing, just not
    exact."""
    if activity is None:
        return Decimal(0)
    if hours_per_day is not None and hours_per_day > 0 and activity.duration_hours is not None:
        return Decimal(str(activity.duration_hours)) / hours_per_day
    return Decimal(str(activity.duration_days)) if activity.duration_days is not None else Decimal(0)


def compute_assignment_budget(
    resource: Resource, activity: Activity | None, assignment: ResourceAssignment,
    hours_per_day: Decimal | None = None,
) -> Decimal:
    rate = Decimal(str(resource.rate))

    # subcontractor/cost: both price as a flat lump sum (2026-07-08, per Maro —
    # cost_type on a "cost" resource is informational only this pass, not a real
    # per-period recurring calc).
    if resource.resource_type in ("subcontractor", "cost"):
        return rate.quantize(_MONEY)

    # labour/equipment/crew: a crew occupies an activity's time the same way
    # labour/equipment does (2026-07-08, per Maro).
    if resource.resource_type in ("labour", "equipment", "crew"):
        duration_days = _exact_duration_days(activity, hours_per_day)
        utilisation = (
            Decimal(str(assignment.utilisation_pct)) if assignment.utilisation_pct is not None else Decimal(100)
        )
        return (duration_days * utilisation / Decimal(100) * rate).quantize(_MONEY)

    # material
    qty = Decimal(str(assignment.quantity)) if assignment.quantity is not None else Decimal(0)
    return (qty * rate).quantize(_MONEY)


def compute_assignment_rate_line_qty(
    resource: Resource, activity: Activity | None, assignment: ResourceAssignment,
    hours_per_day: Decimal | None = None,
) -> Decimal:
    """The qty to show on this assignment's synced CostRateLine (app/services/
    cost_sync.py) — chosen so qty x rate reproduces compute_assignment_budget
    exactly, for whichever formula applies to this resource's type. Callers
    must pass the same hours_per_day both functions were given, or the
    displayed qty x rate will drift from the actually-stored budget total."""
    if resource.resource_type in ("subcontractor", "cost"):
        return Decimal(1)
    if resource.resource_type in ("labour", "equipment", "crew"):
        duration_days = _exact_duration_days(activity, hours_per_day)
        utilisation = (
            Decimal(str(assignment.utilisation_pct)) if assignment.utilisation_pct is not None else Decimal(100)
        )
        return duration_days * utilisation / Decimal(100)
    return Decimal(str(assignment.quantity)) if assignment.quantity is not None else Decimal(0)
