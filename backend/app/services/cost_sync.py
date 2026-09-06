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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cost_element import CostElement
from app.models.cost_rate_line import CostRateLine
from app.models.period import Period
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.schedule_variant import ScheduleVariant
from app.models.user_defined_field import UserDefinedFieldDefinition, UserDefinedFieldValue
from app.services.reference_codes import next_code, next_codes_batch
from app.services.resource_costing import compute_assignment_budget_raw, compute_assignment_rate_line_qty
from app.services.scheduling_cpm import _build_calendar_lookup

_MONEY = Decimal("0.01")


async def _discipline_for_activity(db: AsyncSession, activity: Activity) -> str | None:
    """This activity's own "Discipline" UDF value (2026-07-18, per Maro: "I
    want it by discipline so less items on the cost plan" — a rolled-up-by-
    discipline Cost Plan view needs each schedule-sourced element's
    element_group set to something groupable). Written once per generated
    activity by schedule_bulk_generate.py's own Discipline UDF block — a
    hand-created activity that was never IFC-generated simply has no such
    value, so this returns None and the element's element_group stays null,
    same "leave it blank rather than guess" rule as everywhere else."""
    definition = (await db.execute(
        select(UserDefinedFieldDefinition).where(
            UserDefinedFieldDefinition.project_id == activity.project_id,
            UserDefinedFieldDefinition.entity_type == "activity",
            UserDefinedFieldDefinition.name == "Discipline",
        )
    )).scalar_one_or_none()
    if definition is None:
        return None
    value = (await db.execute(
        select(UserDefinedFieldValue.value_text).where(
            UserDefinedFieldValue.field_definition_id == definition.id,
            UserDefinedFieldValue.record_id == activity.id,
        )
    )).scalar_one_or_none()
    return value


async def _top_level_wbs_branch_names(
    db: AsyncSession, project_id: uuid.UUID, activity_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    """element_group's own fallback when there's no real "Discipline" UDF
    value (2026-09-06, per Maro: a P6-imported or hand-typed schedule —
    never IFC-generated, so _discipline_for_activity always returns None
    for it — showed its whole Cost Plan lumped into one useless
    "(ungrouped)" bucket in the Cost Summary panel). Every schedule has a
    real WBS breakdown though (Interior Finishes, Roof, etc.), even
    without a Discipline UDF, so that's what this groups by instead.

    Uses wbs_role (P|W|T|M — see _activity_role's own header), not raw
    parent-chain depth: depth alone can't tell "one level below a real
    project-root P" (want that node) apart from "IS itself a standalone
    root with no wrapper above it" (want that node too, not something
    above it) — both can be the same depth-1 shape and need the same
    answer for a genuinely different structural reason. Climbing from the
    activity toward the root, the OUTERMOST 'W' found (closest to the
    root — a schedule can nest WBS several levels deep, and this wants the
    top branch, not an intermediate one) wins; if the chain has no 'W' at
    all (a flat schedule with tasks directly under one root, or the
    activity itself resourced directly with nothing above it), the
    outermost 'P' is used instead — for a lone standalone WBS branch with
    no enclosing project wrapper, that P *is* the meaningful branch name,
    not a generic "whole project" label. Batched over the whole project's
    parent_id chain in one query rather than walking each activity's
    ancestors with its own round trip."""
    rows = (await db.execute(
        select(Activity.id, Activity.parent_id, Activity.task_name, Activity.wbs_role)
        .where(Activity.project_id == project_id)
    )).all()
    parent_by_id = {r.id: r.parent_id for r in rows}
    name_by_id = {r.id: r.task_name for r in rows}
    role_by_id = {r.id: r.wbs_role for r in rows}

    def top_level_branch_id(activity_id: uuid.UUID) -> uuid.UUID | None:
        node: uuid.UUID | None = activity_id
        result: uuid.UUID | None = None
        while node is not None:
            role = role_by_id.get(node)
            if role == "W":
                result = node  # overwritten on every W found — the outermost one wins
            elif role == "P" and result is None:
                result = node  # only a fallback if no W was ever found on the way up
            node = parent_by_id.get(node)
        return result

    return {aid: name_by_id.get(top_level_branch_id(aid)) for aid in activity_ids}


async def _get_linked_element(db: AsyncSession, activity_id: uuid.UUID) -> CostElement | None:
    result = await db.execute(select(CostElement).where(CostElement.linked_activity_id == activity_id))
    return result.scalar_one_or_none()


async def _get_or_create_live_period(db: AsyncSession, project_id: uuid.UUID) -> Period:
    """Risk/Cost/ICD's own live reporting Period for the project — unrelated
    to whichever SchedulePeriod/ScheduleVariant the triggering activity lives
    in (docs/SCHEDULE_VARIANTS_PLAN.md split Period in two for exactly this
    reason). Same atomic find-or-create shape as app/api/periods.py's own
    bootstrap_period."""
    result = await db.execute(
        select(Period).where(Period.project_id == project_id).order_by(Period.created_at)
    )
    periods = list(result.scalars().all())
    active = next((p for p in periods if p.freeze_status == "live"), None) or (periods[0] if periods else None)
    if active is not None:
        return active

    period = Period(project_id=project_id, period_label="Period 1", freeze_status="live")
    db.add(period)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        result = await db.execute(
            select(Period).where(Period.project_id == project_id, Period.freeze_status == "live")
        )
        return result.scalar_one()
    await db.refresh(period)
    return period


async def sync_cost_element_from_resources(db: AsyncSession, activity_id: uuid.UUID, *, commit: bool = True) -> None:
    """Called after every resource assignment create/update/delete for an activity.

    commit=False (2026-07-20, optimization pass) — schedule_bulk_generate.py
    and p6_import.py call this once per resource-assigned activity in a
    loop after a real bulk import/generation; each call committing
    individually meant a resource-loaded generation of a few hundred
    activities did a few hundred serialized commits back-to-back. Every
    other caller (resource_assignment.py, resource_assignment_spread.py) is
    a single real-time edit and keeps the default (commit immediately)."""
    activity = await db.get(Activity, activity_id)
    if activity is None:
        return

    # Only the master schedule's resource assignments drive real Cost Plan
    # budget lines (docs/SCHEDULE_VARIANTS_PLAN.md §F) — a "what-if"/recovery/
    # mitigation variant resourcing its own activities shouldn't silently
    # create or move real budget, since it isn't the schedule of record until
    # (if ever) promoted. promote_variant re-links any existing schedule-
    # sourced elements onto the new master's matching-code activities, so this
    # gate never orphans a link that promotion is about to fix up anyway.
    variant = await db.get(ScheduleVariant, activity.schedule_variant_id)
    if variant is None or not variant.is_master:
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
            if commit:
                await db.commit()
        return

    resources_result = await db.execute(
        select(Resource).where(Resource.id.in_({a.resource_id for a in assignments}))
    )
    resources_by_id = {r.id: r for r in resources_result.scalars().all()}
    # Exact hours_per_day, not activity.duration_days' own rounded-to-2dp
    # display value (2026-09-05, per Maro: "time is costed by the hour" —
    # see compute_assignment_budget's own header for the real, quantified
    # rounding cost this avoids).
    lookup = await _build_calendar_lookup(db, activity.project_id)
    hours_per_day = lookup.hours_per_day(lookup.resolve(activity))
    # Full-precision per assignment, rounded once at the total — never sum
    # already-rounded lines (see compute_assignment_budget_raw's own
    # header: verified against a real 11-assignment P6 activity where
    # rounding each line first drifts a whole penny off P6's own BAC).
    total_budget = sum(
        (
            compute_assignment_budget_raw(resources_by_id[a.resource_id], activity, a, hours_per_day)
            for a in assignments
        ),
        Decimal(0),
    ).quantize(_MONEY)
    description = f"{activity.code}: {activity.task_name}"
    discipline = await _discipline_for_activity(db, activity)
    if discipline is None:
        discipline = (await _top_level_wbs_branch_names(db, activity.project_id, {activity.id}))[activity.id]

    if element is None:
        code = await next_code(db, CostElement, "CST", activity.project_id)
        live_period = await _get_or_create_live_period(db, activity.project_id)
        element = CostElement(
            project_id=activity.project_id,
            period_id=live_period.id,
            code=code,
            element_type="fixed",
            element_group=discipline,
            description=description,
            source="schedule",
            linked_activity_id=activity.id,
            budget=total_budget,
            # Physical progress mirrors the activity's own — see
            # sync_cost_element_pct_complete below for the ongoing one-way sync;
            # this covers the case where the activity already had progress
            # recorded before its first resource was ever assigned.
            pct_complete=int(activity.pct_complete) if activity.pct_complete is not None else None,
        )
        db.add(element)
        await db.flush()
    else:
        element.description = description
        element.element_group = discipline
        element.budget = total_budget
        await db.execute(delete(CostRateLine).where(CostRateLine.cost_element_id == element.id))

    for a in assignments:
        resource = resources_by_id[a.resource_id]
        label = resource.name if not a.role else f"{resource.name} ({a.role})"
        qty = compute_assignment_rate_line_qty(resource, activity, a, hours_per_day)
        db.add(CostRateLine(
            cost_element_id=element.id, description=label, qty=qty, unit=resource.unit, rate=resource.rate,
        ))

    if commit:
        await db.commit()
    else:
        await db.flush()


async def sync_cost_elements_from_resources_bulk(db: AsyncSession, activity_ids: list[uuid.UUID]) -> None:
    """Batched sibling of sync_cost_element_from_resources, for exactly one
    caller: promote_variant's own retroactive "create Cost Elements for a
    newly-promoted master's never-synced activities" pass. That pass calls
    the single-activity version once per resource-assigned activity — each
    call doing 5-7 of its own awaited round trips (db.get(Activity),
    db.get(ScheduleVariant), the linked-element lookup, assignments,
    resources, discipline, next_code, plus a flush) — which measured out to
    roughly 1000 sequential round trips promoting a real 148-activity/417-
    assignment P6 import (2026-09-04, per Maro: "i clearly clicked this once
    and nothing happened... had to refresh" — the promote request wasn't
    stuck, just genuinely that slow with no loading feedback on the button).
    This does the same work — same compute_assignment_budget/
    compute_assignment_rate_line_qty math, same discipline/description/
    manual-unlink rules — in a fixed small number of batched queries
    regardless of how many activities are involved.

    Every activity_id here is assumed to belong to the schedule that just
    became master (promote_variant's own is_master gate already applies at
    the call site — this function doesn't re-check it per activity the way
    the single-activity version does) and to already have at least one
    ResourceAssignment (promote_variant only ever calls this with activity
    ids drawn from a ResourceAssignment query) — so, unlike the
    single-activity version, this never needs to handle "assignments were
    removed, delete the now-orphaned element" here.
    """
    if not activity_ids:
        return

    activities = (await db.execute(select(Activity).where(Activity.id.in_(activity_ids)))).scalars().all()
    activities_by_id = {a.id: a for a in activities}
    if not activities_by_id:
        return
    project_id = next(iter(activities_by_id.values())).project_id

    existing_elements = (await db.execute(
        select(CostElement).where(CostElement.linked_activity_id.in_(activity_ids))
    )).scalars().all()
    element_by_activity_id = {e.linked_activity_id: e for e in existing_elements}

    assignments = (await db.execute(
        select(ResourceAssignment).where(ResourceAssignment.activity_id.in_(activity_ids))
    )).scalars().all()
    assignments_by_activity_id: dict[uuid.UUID, list[ResourceAssignment]] = {}
    for a in assignments:
        assignments_by_activity_id.setdefault(a.activity_id, []).append(a)

    resources = (await db.execute(
        select(Resource).where(Resource.id.in_({a.resource_id for a in assignments}))
    )).scalars().all()
    resources_by_id = {r.id: r for r in resources}

    discipline_def = (await db.execute(
        select(UserDefinedFieldDefinition).where(
            UserDefinedFieldDefinition.project_id == project_id,
            UserDefinedFieldDefinition.entity_type == "activity",
            UserDefinedFieldDefinition.name == "Discipline",
        )
    )).scalar_one_or_none()
    discipline_by_activity_id: dict[uuid.UUID, str | None] = {}
    if discipline_def is not None:
        discipline_values = (await db.execute(
            select(UserDefinedFieldValue).where(
                UserDefinedFieldValue.field_definition_id == discipline_def.id,
                UserDefinedFieldValue.record_id.in_(activity_ids),
            )
        )).scalars().all()
        discipline_by_activity_id = {v.record_id: v.value_text for v in discipline_values}
    # Same top-level-WBS-branch fallback the single-activity version uses,
    # batched here — only for activities with no real Discipline value, not
    # the whole project's worth of activities every single time.
    needs_fallback = {aid for aid in activity_ids if not discipline_by_activity_id.get(aid)}
    if needs_fallback:
        fallback_by_activity_id = await _top_level_wbs_branch_names(db, project_id, needs_fallback)
        for aid, name in fallback_by_activity_id.items():
            if name is not None:
                discipline_by_activity_id[aid] = name

    live_period = await _get_or_create_live_period(db, project_id)
    # Exact hours_per_day per activity's own calendar (2026-09-05, per Maro:
    # "time is costed by the hour") — one lookup for the whole batch, not
    # one query per activity.
    calendar_lookup = await _build_calendar_lookup(db, project_id)

    to_create: list[uuid.UUID] = []
    updating_element_ids: list[uuid.UUID] = []
    for activity_id in activity_ids:
        activity = activities_by_id.get(activity_id)
        activity_assignments = assignments_by_activity_id.get(activity_id)
        if activity is None or not activity_assignments:
            continue
        element = element_by_activity_id.get(activity_id)
        if element is not None and element.source == "manual":
            continue  # unlinked — same rule as the single-activity version
        if element is None:
            to_create.append(activity_id)
        else:
            updating_element_ids.append(element.id)

    # Old rate lines for every element being updated are cleared up front, in
    # one statement — before the loop below adds this call's own new ones,
    # so there's no risk of the delete catching rows it just inserted.
    if updating_element_ids:
        await db.execute(delete(CostRateLine).where(CostRateLine.cost_element_id.in_(updating_element_ids)))

    new_codes = iter(await next_codes_batch(db, CostElement, "CST", project_id, len(to_create)))

    for activity_id in activity_ids:
        activity = activities_by_id.get(activity_id)
        activity_assignments = assignments_by_activity_id.get(activity_id)
        if activity is None or not activity_assignments:
            continue
        element = element_by_activity_id.get(activity_id)
        if element is not None and element.source == "manual":
            continue

        hours_per_day = calendar_lookup.hours_per_day(calendar_lookup.resolve(activity))
        # Full-precision per assignment, rounded once at the total — see
        # compute_assignment_budget_raw's own header.
        total_budget = sum(
            (
                compute_assignment_budget_raw(resources_by_id[a.resource_id], activity, a, hours_per_day)
                for a in activity_assignments
            ),
            Decimal(0),
        ).quantize(_MONEY)
        description = f"{activity.code}: {activity.task_name}"
        discipline = discipline_by_activity_id.get(activity_id)

        if element is None:
            element = CostElement(
                id=uuid.uuid4(), project_id=project_id, period_id=live_period.id, code=next(new_codes),
                element_type="fixed", element_group=discipline, description=description,
                source="schedule", linked_activity_id=activity.id, budget=total_budget,
                pct_complete=int(activity.pct_complete) if activity.pct_complete is not None else None,
            )
            db.add(element)  # id assigned client-side above — no per-row flush needed for the CostRateLine rows below
        else:
            element.description = description
            element.element_group = discipline
            element.budget = total_budget

        for a in activity_assignments:
            resource = resources_by_id[a.resource_id]
            label = resource.name if not a.role else f"{resource.name} ({a.role})"
            qty = compute_assignment_rate_line_qty(resource, activity, a, hours_per_day)
            db.add(CostRateLine(
                cost_element_id=element.id, description=label, qty=qty, unit=resource.unit, rate=resource.rate,
            ))

    await db.flush()


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


async def delete_linked_cost_elements_bulk(db: AsyncSession, activity_ids: set[uuid.UUID]) -> None:
    """Same cleanup as delete_linked_cost_element, batched for a whole WBS
    subtree being deleted at once (app/services/activity.py:delete_activity's
    cascade) — one query to find every schedule-managed linked element
    across the entire subtree, one batched rate-line delete, one batched
    element delete, one commit, instead of that same round-trip per
    activity in the subtree."""
    if not activity_ids:
        return
    elements = (await db.execute(
        select(CostElement).where(CostElement.linked_activity_id.in_(activity_ids), CostElement.source == "schedule")
    )).scalars().all()
    if not elements:
        return
    element_ids = [el.id for el in elements]
    await db.execute(delete(CostRateLine).where(CostRateLine.cost_element_id.in_(element_ids)))
    await db.execute(delete(CostElement).where(CostElement.id.in_(element_ids)))
    await db.commit()
