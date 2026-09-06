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


def _labour_days(activity: Activity | None, assignment: ResourceAssignment, hours_per_day: Decimal | None) -> Decimal:
    """Days a labour/equipment/crew assignment costs for, shared by
    compute_assignment_budget_raw and compute_assignment_rate_line_qty so
    they can never drift apart. assignment.planned_hours (a P6-imported
    exact hours figure — see its own docstring) wins when set: planned_
    hours/hours_per_day is mathematically identical to duration_days x
    utilisation_pct/100 (utilisation_pct is ITSELF derived as planned_
    hours/duration_hours x 100 at import time — see p6_import.py), just
    without round-tripping through utilisation_pct's own finite stored
    precision in between, which is exactly what leaked a real penny of
    BAC error on a genuine P6 import (2026-09-06). Falls back to the
    duration-relative formula for anything not P6-imported (a hand-created
    Prosota assignment, which has no planned_hours at all and is meant to
    keep scaling live with the activity's own duration)."""
    if assignment.planned_hours is not None and hours_per_day is not None and hours_per_day > 0:
        return Decimal(str(assignment.planned_hours)) / hours_per_day
    duration_days = _exact_duration_days(activity, hours_per_day)
    utilisation = (
        Decimal(str(assignment.utilisation_pct)) if assignment.utilisation_pct is not None else Decimal(100)
    )
    return duration_days * utilisation / Decimal(100)


def compute_assignment_budget_raw(
    resource: Resource, activity: Activity | None, assignment: ResourceAssignment,
    hours_per_day: Decimal | None = None,
) -> Decimal:
    """Full-precision per-assignment cost, unrounded — for a caller that's
    about to SUM several assignments into one total (cost_sync.py's own
    CostElement.budget, ai/context_tools.py's per-resource committed-cost
    ranking). Never round each line before summing them: confirmed against
    a real multi-resource P6 activity ("Unit Finishes Building North -
    Floor 1," 11 resource assignments, none of P6's own own per-assignment
    PlannedCost figures rounded to the penny either) — summing this
    activity's 11 real assignment costs at full precision and rounding
    ONCE gives P6's own exact BAC of £52,197.82; rounding each of the 11
    to the penny first and summing those instead drifts to £52,197.81, a
    real (if tiny) mismatch against the "exact to the decimal" standard.
    compute_assignment_budget below is for anywhere a SINGLE assignment's
    own cost is shown as its own line (Resource Usage/Tracking, a
    CostRateLine) — those still round individually, same as any other
    displayed money figure."""
    rate = Decimal(str(resource.rate))

    # subcontractor/cost: both price as a flat lump sum (2026-07-08, per Maro —
    # cost_type on a "cost" resource is informational only this pass, not a real
    # per-period recurring calc).
    if resource.resource_type in ("subcontractor", "cost"):
        return rate

    # labour/equipment/crew: a crew occupies an activity's time the same way
    # labour/equipment does (2026-07-08, per Maro).
    if resource.resource_type in ("labour", "equipment", "crew"):
        return _labour_days(activity, assignment, hours_per_day) * rate

    # material
    qty = Decimal(str(assignment.quantity)) if assignment.quantity is not None else Decimal(0)
    return qty * rate


def compute_assignment_budget(
    resource: Resource, activity: Activity | None, assignment: ResourceAssignment,
    hours_per_day: Decimal | None = None,
) -> Decimal:
    """This single assignment's own cost, rounded to the penny for display
    as its own line (Resource Usage/Tracking, a CostRateLine). A caller
    about to sum several assignments into one total must use
    compute_assignment_budget_raw above instead and round only the sum —
    see its own docstring for why rounding each line first is a real,
    verified-against-P6 mismatch, not just a theoretical concern."""
    return compute_assignment_budget_raw(resource, activity, assignment, hours_per_day).quantize(_MONEY)


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
        return _labour_days(activity, assignment, hours_per_day)
    return Decimal(str(assignment.quantity)) if assignment.quantity is not None else Decimal(0)
