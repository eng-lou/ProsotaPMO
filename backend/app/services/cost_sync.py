"""One-way sync (Scheduling -> Cost Plan): keeps an activity's linked Cost Element
in step with its resource assignments. Per Maro's confirmed spec
(docs/RESOURCES_MODULE_PLAN.md): resource assignments are the source of truth for
a resourced activity's budget until a user deliberately edits that element's
budget or rate lines directly in Cost Plan, which permanently unlinks it
(app/services/cost_element.py:update_cost_element,
app/services/cost_rate_line.py:create_rate_line/update_rate_line/delete_rate_line).
Once unlinked (source="manual"), this module leaves the element alone entirely —
there is deliberately no path back from Cost Plan into ResourceAssignment rows,
avoiding a two-way sync conflict.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cost_element import CostElement
from app.models.cost_rate_line import CostRateLine
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.services.reference_codes import next_code
from app.services.resource_costing import compute_assignment_budget, compute_assignment_rate_line_qty


async def _get_linked_element(db: AsyncSession, activity_id: uuid.UUID) -> CostElement | None:
    result = await db.execute(select(CostElement).where(CostElement.linked_activity_id == activity_id))
    return result.scalar_one_or_none()


async def sync_cost_element_from_resources(db: AsyncSession, activity_id: uuid.UUID) -> None:
    """Called after every resource assignment create/update/delete for an activity."""
    activity = await db.get(Activity, activity_id)
    if activity is None:
        return

    element = await _get_linked_element(db, activity_id)
    if element is not None and element.source == "manual":
        return  # unlinked — Scheduling no longer manages this element, in either direction

    assignments_result = await db.execute(
        select(ResourceAssignment).where(ResourceAssignment.activity_id == activity_id)
    )
    assignments = list(assignments_result.scalars().all())

    if not assignments:
        if element is not None:
            await db.execute(delete(CostRateLine).where(CostRateLine.cost_element_id == element.id))
            await db.delete(element)
            await db.commit()
        return

    resources_result = await db.execute(
        select(Resource).where(Resource.id.in_({a.resource_id for a in assignments}))
    )
    resources_by_id = {r.id: r for r in resources_result.scalars().all()}
    total_budget = sum(
        (compute_assignment_budget(resources_by_id[a.resource_id], activity, a) for a in assignments),
        Decimal(0),
    )
    description = f"{activity.code}: {activity.task_name}"

    if element is None:
        code = await next_code(db, CostElement, "CST", activity.project_id)
        element = CostElement(
            project_id=activity.project_id,
            period_id=activity.period_id,
            code=code,
            element_type="fixed",
            description=description,
            source="schedule",
            linked_activity_id=activity.id,
            budget=total_budget,
            # Physical progress mirrors the activity's own — see
            # sync_cost_element_pct_complete below for the ongoing one-way sync;
            # this covers the case where the activity already had progress
            # recorded before its first resource was ever assigned.
            pct_complete=int(activity.pct_complete) if activity.pct_complete is not None else None,
            # Same "set once at creation, frozen thereafter" discipline as every
            # other cost element's rev_a_baseline — see app/models/cost_element.py.
            rev_a_baseline=total_budget,
        )
        db.add(element)
        await db.flush()
    else:
        element.description = description
        element.budget = total_budget
        await db.execute(delete(CostRateLine).where(CostRateLine.cost_element_id == element.id))

    for a in assignments:
        resource = resources_by_id[a.resource_id]
        label = resource.name if not a.role else f"{resource.name} ({a.role})"
        qty = compute_assignment_rate_line_qty(resource, activity, a)
        db.add(CostRateLine(
            cost_element_id=element.id, description=label, qty=qty, unit=resource.unit, rate=resource.rate,
        ))

    await db.commit()


async def sync_cost_element_pct_complete(db: AsyncSession, activity: Activity) -> None:
    """Physical progress is a schedule fact, tracked once on the Activity
    (Scheduling's own % Complete column) — a schedule-linked Cost Element must
    mirror it exactly rather than carry a second, independently-editable
    estimate of the same thing. Without this, Scheduling's EVM columns and Cost
    Plan's EVM for the same line silently diverge depending on which screen was
    last edited. Called after every activity update; a no-op for activities with
    no linked element, or one a user has since unlinked (source='manual')."""
    element = await _get_linked_element(db, activity.id)
    if element is None or element.source != "schedule":
        return
    new_value = int(activity.pct_complete) if activity.pct_complete is not None else None
    if element.pct_complete != new_value:
        element.pct_complete = new_value
        await db.commit()


async def sync_activity_actuals(db: AsyncSession, activity_id: uuid.UUID, actuals: Decimal | None) -> None:
    """Lets a user record Actual Cost directly against a resourced activity from
    Scheduling's Resources tab — matching how P6 captures Actual Cost alongside
    resource assignments, rather than needing to jump to Cost Plan to enter it.
    Writes straight onto the linked Cost Element's own `actuals` field. Unlike
    budget, `actuals` was already freely editable on a schedule-linked element
    without triggering the unlink warning (see cost_element.py:update_cost_element
    — only a budget edit unlinks), so this doesn't introduce a second, conflicting
    owner of the figure, just a more convenient place to enter it. Raises if
    there's no resourced cost line yet — there's nothing to attach actuals to."""
    element = await _get_linked_element(db, activity_id)
    if element is None or element.source != "schedule":
        raise HTTPException(status_code=422, detail="Assign a resource to this activity before recording actuals")
    element.actuals = actuals
    await db.commit()


async def delete_linked_cost_element(db: AsyncSession, activity_id: uuid.UUID) -> None:
    """Cleans up a schedule-managed cost element when its activity is being deleted
    outright — called from app/services/activity.py:delete_activity. A manually
    unlinked element (source="manual") is left in place untouched, same rule as
    everywhere else in this module: once unlinked, Scheduling doesn't touch it."""
    element = await _get_linked_element(db, activity_id)
    if element is None or element.source != "schedule":
        return
    await db.execute(delete(CostRateLine).where(CostRateLine.cost_element_id == element.id))
    await db.delete(element)
    await db.commit()
