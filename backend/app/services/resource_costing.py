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


def compute_assignment_budget(
    resource: Resource, activity: Activity | None, assignment: ResourceAssignment
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
        duration_days = (
            Decimal(str(activity.duration_days))
            if activity is not None and activity.duration_days is not None
            else Decimal(0)
        )
        utilisation = (
            Decimal(str(assignment.utilisation_pct)) if assignment.utilisation_pct is not None else Decimal(100)
        )
        return (duration_days * utilisation / Decimal(100) * rate).quantize(_MONEY)

    # material
    qty = Decimal(str(assignment.quantity)) if assignment.quantity is not None else Decimal(0)
    return (qty * rate).quantize(_MONEY)


def compute_assignment_rate_line_qty(
    resource: Resource, activity: Activity | None, assignment: ResourceAssignment
) -> Decimal:
    """The qty to show on this assignment's synced CostRateLine (app/services/
    cost_sync.py) — chosen so qty x rate reproduces compute_assignment_budget
    exactly, for whichever formula applies to this resource's type."""
    if resource.resource_type in ("subcontractor", "cost"):
        return Decimal(1)
    if resource.resource_type in ("labour", "equipment", "crew"):
        duration_days = (
            Decimal(str(activity.duration_days))
            if activity is not None and activity.duration_days is not None
            else Decimal(0)
        )
        utilisation = (
            Decimal(str(assignment.utilisation_pct)) if assignment.utilisation_pct is not None else Decimal(100)
        )
        return duration_days * utilisation / Decimal(100)
    return Decimal(str(assignment.quantity)) if assignment.quantity is not None else Decimal(0)
