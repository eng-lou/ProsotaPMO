from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import time
from decimal import Decimal
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import Integer, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_code_history import ActivityCodeHistory
from app.models.activity_relationship import ActivityRelationship
from app.models.calendar import Calendar
from app.models.cost_element import CostElement
from app.models.period import Period
from app.models.schedule_baseline import ScheduleBaselineActivity
from app.schemas.activity import ActivityCreate, ActivityUpdate, _validate_constraint
from app.schemas.reassessment import ReassessmentCreate
from app.services import cost_sync, scheduling_cpm
from app.services.cost_element import compute_schedule_linked_evm
from app.services.reassessment import create_reassessment
from app.services.scheduling_cpm import data_date_time_for_period, default_day_start_times, elapsed_duration_fraction

_EVM_FIELDS = ("bac", "ac", "pv", "ev", "cv", "sv", "cpi", "spi", "eac", "etc")


async def _attach_evm_fields(db: AsyncSession, activities: list[Activity]) -> None:
    """duration_pct_complete, plus AC/PV/EV/CV/SV/CPI/SPI/BAC/EAC/ETC sourced
    from each activity's linked "schedule" Cost Element (if any) — see
    app/services/cost_sync.py. An activity with no resources assigned (no
    linked element yet) simply shows nulls for the cost-side fields, same
    "leave it blank rather than fake a number" rule used everywhere else.
    duration_pct_complete itself needs no resources — it's a pure schedule
    figure. Batched (one query for the whole list) rather than per-activity,
    matching the resource-assignment N+1 fix in
    app/services/resource_assignment.py.

    PV is prorated against the activity's own live start/finish (not
    bl_start/bl_finish) — per Maro's confirmed correction (P6 domain expertise):
    "Set Baseline" drives schedule variance (Fin. Var (d)), not Planned Value.
    PV asks "how far along its own current duration should this activity be by
    the data date," independent of whether a baseline has ever been captured —
    see app/services/cost_element.py:_schedule_evm. The data date itself is
    each activity's period's own data_date_for_period (moved by Reschedule),
    not the real wall-clock date — otherwise rescheduling the data date
    wouldn't move PV at all."""
    if not activities:
        return
    result = await db.execute(
        select(CostElement).where(
            CostElement.linked_activity_id.in_([a.id for a in activities]),
            CostElement.source == "schedule",
        )
    )
    elements_by_activity = {el.linked_activity_id: el for el in result.scalars().all()}
    period_ids = {a.period_id for a in activities}
    periods = list((await db.execute(select(Period).where(Period.id.in_(period_ids)))).scalars().all())
    default_starts = await default_day_start_times(db, {p.project_id for p in periods})
    data_dates = {
        p.id: data_date_time_for_period(p, default_starts.get(p.project_id, time(8, 0)))
        for p in periods
    }
    for a in activities:
        data_date = data_dates[a.period_id]
        fraction = elapsed_duration_fraction(a.start, a.finish, data_date)
        # "Duration % Complete" — how far along its own current schedule this
        # activity should be, distinct from the manually-assessed pct_complete
        # (Physical % Complete) that drives EV. The direct transparency aid
        # Maro asked for: exactly the input PV below is prorated from.
        a.duration_pct_complete = (fraction * Decimal(100)).quantize(Decimal("0.01")) if fraction is not None else None

        element = elements_by_activity.get(a.id)
        if element is None:
            for field in _EVM_FIELDS:
                setattr(a, field, None)
            continue
        evm = compute_schedule_linked_evm(element, a.start, a.finish, data_date)
        for field in _EVM_FIELDS:
            setattr(a, field, evm[field])


async def _require_live_period(db: AsyncSession, period_id: uuid.UUID) -> None:
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    if period.freeze_status != "live":
        raise HTTPException(
            status_code=422,
            detail=f"Period '{period.period_label}' is {period.freeze_status}. Writes to frozen periods are not allowed.",
        )


async def _validate_calendar_in_project(db: AsyncSession, calendar_id: uuid.UUID, project_id: uuid.UUID) -> None:
    calendar = await db.get(Calendar, calendar_id)
    if calendar is None or calendar.project_id != project_id:
        raise HTTPException(status_code=404, detail="Calendar not found in this project")


def _activity_role(activity_type: str, parent_id: uuid.UUID | None) -> str:
    """P (top-level WBS summary) | W (nested WBS summary) | T (task) | M (milestone)
    — the structural role an activity's code prefix should reflect (2026-07-04,
    per Maro's P/W/T/M scheme, e.g. "the overarching WBS summary top of the
    hierarchy can be P-0001")."""
    if activity_type == "milestone":
        return "M"
    if activity_type == "wbs_summary":
        return "P" if parent_id is None else "W"
    return "T"


async def _next_role_code(db: AsyncSession, project_id: uuid.UUID, role: str) -> str:
    """Role-scoped numbering: each of P/W/T/M has its own independent sequence per
    project (2026-07-04, per Maro — "if there's another wbs with that exact code
    then of course W-0002", not sharing a counter with T-codes). Unlike the shared
    app/services/reference_codes.py:next_code() used by Risk/Cost/ICD (exactly one
    prefix per project), activities carry four different prefixes in the same
    table, so the max-lookup must also filter to this role's own prefix."""
    stmt = select(func.max(cast(func.split_part(Activity.code, "-", 2), Integer))).where(
        Activity.project_id == project_id,
        Activity.code.like(f"{role}-%"),
    )
    current_max = (await db.execute(stmt)).scalar()
    next_seq = (current_max or 0) + 1
    return f"{role}-{next_seq:04d}"


def _build_children_map(activities: list[Activity]) -> dict[uuid.UUID | None, list[Activity]]:
    children: dict[uuid.UUID | None, list[Activity]] = defaultdict(list)
    for a in activities:
        children[a.parent_id].append(a)
    for siblings in children.values():
        siblings.sort(key=lambda a: (a.sort_order if a.sort_order is not None else 1_000_000, a.created_at))
    return children


def _dfs_order(activities: list[Activity]) -> list[Activity]:
    """Flatten the outline into display order (parent, then its children, recursively)."""
    children = _build_children_map(activities)
    ordered: list[Activity] = []

    def visit(parent_id: uuid.UUID | None) -> None:
        for node in children.get(parent_id, []):
            ordered.append(node)
            visit(node.id)

    visit(None)
    return ordered


async def list_activities(
    db: AsyncSession,
    project_id: uuid.UUID,
    period_id: uuid.UUID | None = None,
) -> list[Activity]:
    q = select(Activity).where(Activity.project_id == project_id)
    if period_id is not None:
        q = q.where(Activity.period_id == period_id)
    result = await db.execute(q)
    activities = list(result.scalars().all())
    # Returned in outline order (parent immediately followed by its subtree) so the
    # frontend's data grid / Gantt rows line up with the WBS without re-deriving the
    # tree client-side — see docs/SCHEDULING_MODULE_PLAN.md Phase 2.
    ordered = _dfs_order(activities)
    await _attach_evm_fields(db, ordered)
    return ordered


async def list_code_history(db: AsyncSession, activity_id: uuid.UUID) -> list[ActivityCodeHistory]:
    result = await db.execute(
        select(ActivityCodeHistory)
        .where(ActivityCodeHistory.activity_id == activity_id)
        .order_by(ActivityCodeHistory.created_at.desc())
    )
    return list(result.scalars().all())


async def get_activity(db: AsyncSession, activity_id: uuid.UUID) -> Activity:
    activity = await db.get(Activity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    await _attach_evm_fields(db, [activity])
    return activity


async def update_activity_actuals(db: AsyncSession, activity_id: uuid.UUID, actuals: Decimal | None) -> Activity:
    activity = await get_activity(db, activity_id)
    await _require_live_period(db, activity.period_id)
    await cost_sync.sync_activity_actuals(db, activity_id, actuals)
    await _attach_evm_fields(db, [activity])
    return activity



def _apply_computed_fields(activity: Activity) -> None:
    """Recompute the fields that are never accepted directly from clients.

    Per PMBOK7 / Rita Mulcahy Ch. 8 ("Schedule"): variance is finish vs. the
    captured baseline finish — meaningless (and left null) until a baseline
    actually exists (Phase 6). total_float_hours/free_float_hours/is_critical are
    outputs of the Critical Path Method's forward/backward pass
    (app/services/scheduling_cpm.py), not opinions a user types in — same class
    of bug already fixed for Risk's EMV and Cost's CPI/SPI. Set to null here as
    this activity's starting state; scheduling_cpm.recompute_schedule (called
    right after this, in create/update/delete_activity) overwrites them
    moments later for real CPM participants — wbs_summary rows genuinely keep
    them null, they're outside the CPM network.
    """
    activity.variance_days = (
        (activity.finish - activity.bl_finish).days
        if activity.finish is not None and activity.bl_finish is not None
        else None
    )
    activity.total_float_hours = None
    activity.free_float_hours = None
    activity.is_critical = None
    # Remaining Duration is derived, never typed in (Session 16 fix, per Maro):
    # duration x (1 - pct_complete/100) — e.g. 20 days at 10% complete leaves 18
    # days remaining. pct_complete defaults to 0 (not yet assessed = nothing done
    # yet), matching how the UI already shows "0%" for an unset pct_complete.
    activity.remaining_duration_hours = (
        activity.duration_hours * (Decimal(100) - (activity.pct_complete or Decimal(0))) / Decimal(100)
        if activity.duration_hours is not None
        else None
    )


def _validate_no_cycle(
    by_id: dict[uuid.UUID, Activity], activity_id: uuid.UUID | None, new_parent_id: uuid.UUID
) -> None:
    cursor: uuid.UUID | None = new_parent_id
    seen: set[uuid.UUID] = set()
    while cursor is not None:
        if cursor == activity_id:
            raise HTTPException(status_code=422, detail="Cannot set parent: would create a cycle in the WBS")
        if cursor in seen:
            break  # already-inconsistent data — don't loop forever
        seen.add(cursor)
        parent = by_id.get(cursor)
        cursor = parent.parent_id if parent else None


async def _recompute_hierarchy(db: AsyncSession, period_id: uuid.UUID) -> None:
    """Re-derive activity_type/wbs_path/rollups for the whole period's outline.

    Runs after every create/update/delete that could touch the tree — cheap at
    expected schedule sizes (hundreds to low thousands of activities) and far
    simpler than tracking exactly which subtree changed. Per Maro's confirmed
    MS-Project-style decision: any row becomes a WBS Summary automatically as
    soon as something is indented under it, and reverts to a task when it no
    longer has children (docs/SCHEDULING_MODULE_PLAN.md Phase 2).
    """
    result = await db.execute(select(Activity).where(Activity.period_id == period_id))
    activities = list(result.scalars().all())

    # Pin the reserved Archive container to always sort last among top-level
    # activities (2026-07-04, per Maro) — self-correcting on every pass, since
    # a newly-created top-level activity would otherwise land after it (its
    # sort_order is just "current max + 1", and the container had been that
    # max). Done before _build_children_map below so this same pass's
    # wbs_path/ordering already reflects the correction, not just the next one.
    container = next((a for a in activities if a.is_archive_container), None)
    if container is not None:
        top_level_siblings = [a for a in activities if a.parent_id is None and not a.is_archive_container]
        max_sort = max((s.sort_order or 0) for s in top_level_siblings) if top_level_siblings else -1
        if (container.sort_order or 0) <= max_sort:
            container.sort_order = max_sort + 1

    children = _build_children_map(activities)

    for a in activities:
        if a.is_archive_container:
            # Always styled as a WBS summary, regardless of how many archived
            # activities currently sit under it (even zero, momentarily).
            a.activity_type = "wbs_summary"
            continue
        has_children = bool(children.get(a.id))
        if has_children and a.activity_type != "wbs_summary":
            a.activity_type = "wbs_summary"
        elif not has_children and a.activity_type == "wbs_summary":
            a.activity_type = "task"

    # Role-based code prefix (P/W/T/M, 2026-07-04 per Maro) — reassign + log
    # history for any activity whose *structural role* changed in this pass
    # (promoted to WBS, demoted to task, or a WBS moving in/out of top-level).
    # Compared against the stored wbs_role, not the code string itself, since
    # code is also manually editable — see app/models/activity.py's wbs_role
    # field docstring for why that distinction matters. The reserved Archive
    # container keeps its fixed code/role forever; an archived activity's code
    # is likewise frozen at whatever it was the moment it was archived — being
    # reparented under the container would otherwise look exactly like a real
    # promote/demote to this loop and get needlessly renumbered.
    for a in activities:
        if a.is_archive_container or a.is_archived:
            continue
        new_role = _activity_role(a.activity_type, a.parent_id)
        if new_role == a.wbs_role:
            continue
        old_code = a.code
        a.code = await _next_role_code(db, a.project_id, new_role)
        if new_role == "M" or a.wbs_role == "M":
            reason = "manual_edit"  # only an explicit activity_type edit can involve M
        elif a.wbs_role == "T" and new_role in ("P", "W"):
            reason = "promoted_to_wbs"
        elif a.wbs_role in ("P", "W") and new_role == "T":
            reason = "demoted_to_task"
        else:
            reason = "wbs_reparented"  # still a WBS summary, but P<->W (top-level status changed)
        db.add(ActivityCodeHistory(activity_id=a.id, old_code=old_code, new_code=a.code, reason=reason))
        a.wbs_role = new_role

    def assign_codes(parent_id: uuid.UUID | None, prefix: str) -> None:
        for i, child in enumerate(children.get(parent_id, []), start=1):
            code = str(i) if not prefix else f"{prefix}.{i}"
            child.wbs_path = code
            assign_codes(child.id, code)

    assign_codes(None, "")

    def rollup(node_id: uuid.UUID) -> None:
        for child in children.get(node_id, []):
            rollup(child.id)

    by_id = {a.id: a for a in activities}
    for root in children.get(None, []):
        rollup(root.id)

    for node in activities:
        if node.activity_type != "wbs_summary":
            continue
        kids = children.get(node.id, [])
        starts = [k.start for k in kids if k.start is not None]
        finishes = [k.finish for k in kids if k.finish is not None]
        node.start = min(starts) if starts else None
        node.finish = max(finishes) if finishes else None
        node.duration_days = (
            Decimal((node.finish - node.start).days) if node.start and node.finish else None
        )
        weighted = [(k.pct_complete, k.duration_hours or 0) for k in kids if k.pct_complete is not None]
        total_weight = sum(w for _, w in weighted)
        if weighted and total_weight > 0:
            node.pct_complete = sum(Decimal(str(p)) * w for p, w in weighted) / Decimal(total_weight)
        elif weighted:
            node.pct_complete = sum(Decimal(str(p)) for p, _ in weighted) / len(weighted)
        else:
            node.pct_complete = None
        _apply_computed_fields(node)

    # Refresh only the rows this pass actually modified — captured as a set of
    # ids *before* commit, since committing clears SQLAlchemy's dirty-tracking.
    # Without refreshing a changed row, it keeps a server-computed column
    # (updated_at's onupdate=func.now()) expired in the session's identity map;
    # the next unrelated read of that same object in the same session — a later
    # request sharing this session, e.g. in tests — raises MissingGreenlet
    # trying to lazily refresh it outside an awaited context. Real request
    # handling gets a fresh session per call (app/database.py:get_db), so this
    # is latent rather than a request-facing bug today — but refreshing *every*
    # activity in the period regardless of whether it changed was a genuine,
    # measured performance bug: one extra DB round trip per activity, on every
    # single create/update/delete, even when only one row actually changed
    # (found at ~140-activity schedule scale, 2026-07-04 per Maro).
    dirty_ids = {a.id for a in activities if db.is_modified(a)}
    await db.commit()
    for a in activities:
        if a.id in dirty_ids:
            await db.refresh(a)


def _parent_filter(parent_id: uuid.UUID | None):
    return Activity.parent_id.is_(None) if parent_id is None else Activity.parent_id == parent_id


async def _next_sibling_sort_order(
    db: AsyncSession, period_id: uuid.UUID, parent_id: uuid.UUID | None, exclude_id: uuid.UUID | None = None
) -> int:
    q = select(Activity).where(Activity.period_id == period_id, _parent_filter(parent_id))
    if exclude_id is not None:
        q = q.where(Activity.id != exclude_id)
    siblings = list((await db.execute(q)).scalars().all())
    return max((s.sort_order or 0) for s in siblings) + 1 if siblings else 0


async def _next_sibling_sort_order_after(
    db: AsyncSession, period_id: uuid.UUID, parent_id: uuid.UUID | None, after_id: uuid.UUID,
) -> int:
    """Same self-healing renumber-then-insert approach as move_activity: normalises
    every current sibling to sequential 0..n-1 sort_order, then makes room for a
    new activity to land immediately after `after_id` rather than appended at the
    end (2026-07-04, per Maro — Duplicate should place the copy right next to its
    source, not wherever the group's current end happens to be, e.g. past the
    reserved Archive container)."""
    q = select(Activity).where(Activity.period_id == period_id, _parent_filter(parent_id))
    siblings = list((await db.execute(q)).scalars().all())
    siblings.sort(key=lambda a: (a.sort_order if a.sort_order is not None else 1_000_000, a.created_at))
    for index, sibling in enumerate(siblings):
        sibling.sort_order = index

    after_index = next((i for i, s in enumerate(siblings) if s.id == after_id), len(siblings) - 1)
    insert_at = after_index + 1
    for sibling in siblings[insert_at:]:
        sibling.sort_order += 1
    return insert_at


async def move_activity(db: AsyncSession, activity_id: uuid.UUID, direction: Literal["up", "down"]) -> Activity:
    """Reorder an activity among its current siblings — display order and WBS
    numbering only, never hierarchy level (that's indent/outdent, a parent_id
    change) and never CPM dates/float (sort_order doesn't feed the CPM engine
    at all). Per Maro: indent/outdent alone left him "stuck depending on the
    sequence of activity creation" — a newly-created activity always lands
    last among its siblings (_next_sibling_sort_order), with no way to
    reposition it afterward without deleting and recreating in the right
    order. A no-op (not an error) at either end of the sibling list — same
    "boundary just does nothing" convention as indent (index 0) and outdent
    (no parent) in the frontend.

    Normalises every sibling's sort_order to sequential 0..n-1 positions on
    every call, self-healing any legacy null/duplicate values (the
    tie-break-by-created_at fallback elsewhere in this file) rather than
    needing a one-off backfill migration."""
    activity = await get_activity(db, activity_id)
    await _require_live_period(db, activity.period_id)

    result = await db.execute(
        select(Activity).where(Activity.period_id == activity.period_id, _parent_filter(activity.parent_id))
    )
    siblings = list(result.scalars().all())
    siblings.sort(key=lambda a: (a.sort_order if a.sort_order is not None else 1_000_000, a.created_at))
    for index, sibling in enumerate(siblings):
        sibling.sort_order = index

    current_index = next(i for i, s in enumerate(siblings) if s.id == activity.id)
    target_index = current_index - 1 if direction == "up" else current_index + 1
    if 0 <= target_index < len(siblings):
        siblings[current_index].sort_order, siblings[target_index].sort_order = (
            siblings[target_index].sort_order,
            siblings[current_index].sort_order,
        )

    await db.commit()
    await _recompute_hierarchy(db, activity.period_id)
    await _attach_evm_fields(db, [activity])
    return activity


async def create_activity(db: AsyncSession, data: ActivityCreate) -> Activity:
    await _require_live_period(db, data.period_id)

    if data.parent_id is not None:
        parent = await db.get(Activity, data.parent_id)
        if parent is None or parent.period_id != data.period_id:
            raise HTTPException(status_code=404, detail="Parent activity not found in this period")

    if data.calendar_id is not None:
        await _validate_calendar_in_project(db, data.calendar_id, data.project_id)

    if data.insert_after_id is not None:
        after = await db.get(Activity, data.insert_after_id)
        if after is None or after.period_id != data.period_id or after.parent_id != data.parent_id:
            raise HTTPException(status_code=404, detail="insert_after_id activity not found among these siblings")
        next_sort_order = await _next_sibling_sort_order_after(db, data.period_id, data.parent_id, data.insert_after_id)
    else:
        next_sort_order = await _next_sibling_sort_order(db, data.period_id, data.parent_id)
    # A brand-new activity has zero children, so a "wbs_summary" request would be
    # reverted to "task" the moment _recompute_hierarchy runs right after this —
    # anticipate that here so the code/role are right immediately, rather than
    # generating a WBS-role code that gets renumbered away again a moment later.
    effective_type = "task" if data.activity_type == "wbs_summary" else data.activity_type
    role = _activity_role(effective_type, data.parent_id)
    code = await _next_role_code(db, data.project_id, role)
    activity = Activity(
        **data.model_dump(exclude={"insert_after_id"}), code=code, wbs_role=role, sort_order=next_sort_order,
    )
    _apply_computed_fields(activity)
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    await _recompute_hierarchy(db, data.period_id)
    await scheduling_cpm.recompute_schedule(db, data.period_id)
    await _attach_evm_fields(db, [activity])
    return activity


async def update_activity(
    db: AsyncSession, activity_id: uuid.UUID, data: ActivityUpdate
) -> Activity:
    activity = await get_activity(db, activity_id)
    await _require_live_period(db, activity.period_id)

    updates = data.model_dump(exclude_unset=True)
    old_code = activity.code

    if "code" in updates and updates["code"] is not None:
        new_code = updates["code"]
        existing = await db.execute(
            select(Activity).where(
                Activity.project_id == activity.project_id,
                Activity.code == new_code,
                Activity.id != activity.id,
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=422, detail=f"Code '{new_code}' is already in use — enter a unique code instead."
            )

    if "finish" in updates:
        target_finish = updates.pop("finish")
        if target_finish is not None:
            updates["duration_hours"] = await scheduling_cpm.compute_duration_for_finish(db, activity, target_finish)

    if activity.is_archive_container:
        raise HTTPException(status_code=422, detail="The Archived container can't be edited directly")

    if "parent_id" in updates and updates["parent_id"] is not None:
        result = await db.execute(select(Activity).where(Activity.period_id == activity.period_id))
        by_id = {a.id: a for a in result.scalars().all()}
        _validate_no_cycle(by_id, activity_id, updates["parent_id"])
        if updates["parent_id"] not in by_id:
            raise HTTPException(status_code=404, detail="Parent activity not found in this period")
        if by_id[updates["parent_id"]].is_archive_container:
            raise HTTPException(
                status_code=422,
                detail="Can't indent an activity under the Archived container directly — use Archive instead",
            )

    if updates.get("calendar_id") is not None:
        await _validate_calendar_in_project(db, updates["calendar_id"], activity.project_id)

    parent_changed = "parent_id" in updates and updates["parent_id"] != activity.parent_id
    for field, value in updates.items():
        setattr(activity, field, value)
    if parent_changed:
        activity.sort_order = await _next_sibling_sort_order(
            db, activity.period_id, activity.parent_id, exclude_id=activity.id
        )

    # A manual code rename (inline editing) is a deliberate human choice, distinct
    # from the automatic promote/demote renumbering _recompute_hierarchy does below
    # — logged the same way so the audit trail covers both (2026-07-04, per Maro).
    if "code" in updates and updates["code"] is not None and updates["code"] != old_code:
        db.add(ActivityCodeHistory(
            activity_id=activity.id, old_code=old_code, new_code=updates["code"], reason="manual_edit",
        ))

    # ActivityUpdate can't run this as a schema-level validator (a partial PATCH can't
    # tell "field not sent" from "explicitly cleared to null"), so it's checked here
    # against the activity's final, fully-resolved state instead.
    try:
        _validate_constraint(activity.constraint_type, activity.constraint_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    _apply_computed_fields(activity)
    await db.commit()

    await _recompute_hierarchy(db, activity.period_id)
    await scheduling_cpm.recompute_schedule(db, activity.period_id)
    if "pct_complete" in updates:
        await cost_sync.sync_cost_element_pct_complete(db, activity)
    await _attach_evm_fields(db, [activity])
    return activity


async def _subtree_ids(db: AsyncSession, period_id: uuid.UUID, root_id: uuid.UUID) -> set[uuid.UUID]:
    result = await db.execute(select(Activity).where(Activity.period_id == period_id))
    children = _build_children_map(list(result.scalars().all()))
    ids: set[uuid.UUID] = {root_id}

    def visit(node_id: uuid.UUID) -> None:
        for child in children.get(node_id, []):
            ids.add(child.id)
            visit(child.id)

    visit(root_id)
    return ids


async def _has_baseline_history(db: AsyncSession, activity_ids: set[uuid.UUID]) -> bool:
    result = await db.execute(
        select(ScheduleBaselineActivity.id)
        .where(ScheduleBaselineActivity.activity_id.in_(activity_ids))
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _get_or_create_archive_container(db: AsyncSession, period_id: uuid.UUID) -> Activity:
    """The one reserved "Archived" WBS per period that archived activities get
    reparented under (2026-07-04, per Maro) — lazily created the first time
    anything in that period is archived. Its own code uses a fifth, reserved
    role ("A") via the same per-project _next_role_code sequence everything
    else uses, rather than a bare fixed string — avoids any risk of colliding
    with a real P/W/T/M code, and sidesteps needing this container to be
    unique per *project* if a project ever has more than one period."""
    result = await db.execute(
        select(Activity).where(Activity.period_id == period_id, Activity.is_archive_container.is_(True))
    )
    container = result.scalar_one_or_none()
    if container is not None:
        return container

    period = await db.get(Period, period_id)
    next_sort_order = await _next_sibling_sort_order(db, period_id, None)
    container = Activity(
        project_id=period.project_id,
        period_id=period_id,
        task_name="Archived",
        activity_type="wbs_summary",
        code=await _next_role_code(db, period.project_id, "A"),
        wbs_role="A",
        is_archive_container=True,
        sort_order=next_sort_order,
    )
    db.add(container)
    await db.commit()
    await db.refresh(container)
    return container


async def archive_activity(db: AsyncSession, activity_id: uuid.UUID, cascade: bool = True) -> list[Activity]:
    """Actualise + reparent under the Archived container, instead of deleting
    (2026-07-04, per Maro): forces pct_complete to 100 ("all work is done to
    this point, not expecting to do more") and strips every relationship the
    archived subtree had, so it no longer drives or is driven by the live CPM
    network — but the row itself (and any baseline snapshot pointing at it)
    stays, for audit/assurance, rather than being lost outright. cascade=True
    (default) archives the whole WBS subtree together; cascade=False archives
    only this row, promoting its direct children up to its former parent
    first — same choice delete_activity already offers.

    Codes are deliberately left untouched here (unlike a real promote/demote,
    which _recompute_hierarchy renumbers) — the whole point is a stable,
    traceable reference back to what this activity was."""
    activity = await get_activity(db, activity_id)
    await _require_live_period(db, activity.period_id)
    if activity.is_archive_container:
        raise HTTPException(status_code=422, detail="The Archived container can't be archived")
    period_id = activity.period_id

    doomed_ids = {activity_id} if cascade is False else await _subtree_ids(db, period_id, activity_id)

    rel_result = await db.execute(
        select(ActivityRelationship).where(
            or_(
                ActivityRelationship.predecessor_id.in_(doomed_ids),
                ActivityRelationship.successor_id.in_(doomed_ids),
            )
        )
    )
    for rel in rel_result.scalars().all():
        await db.delete(rel)
    await db.commit()

    if not cascade:
        result = await db.execute(select(Activity).where(Activity.parent_id == activity_id))
        children = list(result.scalars().all())
        for child in children:
            child.parent_id = activity.parent_id
            child.sort_order = await _next_sibling_sort_order(
                db, period_id, activity.parent_id, exclude_id=child.id
            )
        await db.commit()

    archived_result = await db.execute(select(Activity).where(Activity.id.in_(doomed_ids)))
    archived_activities = list(archived_result.scalars().all())
    for a in archived_activities:
        a.pct_complete = Decimal(100)
        a.is_archived = True
        _apply_computed_fields(a)

    container = await _get_or_create_archive_container(db, period_id)
    activity.parent_id = container.id
    activity.sort_order = await _next_sibling_sort_order(db, period_id, container.id, exclude_id=activity.id)

    await db.commit()
    for a in archived_activities:
        await db.refresh(a)

    await create_reassessment(db, ReassessmentCreate(
        record_type="activity", record_id=activity.id,
        note="Archived — actualised to 100% complete, relationships removed, moved under the Archived WBS.",
    ))

    await _recompute_hierarchy(db, period_id)
    await scheduling_cpm.recompute_schedule(db, period_id)
    await _attach_evm_fields(db, archived_activities)
    return archived_activities


async def delete_activity(db: AsyncSession, activity_id: uuid.UUID, cascade: bool = True) -> bool:
    """Delete an activity. cascade=True (default) removes its whole WBS subtree too
    (MS Project's usual "delete summary task" behaviour). cascade=False deletes only
    this row and promotes its direct children up to its own level — they become
    siblings of what used to be this activity's siblings, per Maro's confirmed spec.

    Returns True if the activity was archived instead of deleted — an activity
    (or, in a cascade, any activity in its subtree) that appears in a saved
    baseline snapshot can no longer be hard-deleted at all (2026-07-04, per
    Maro): that would sever the very audit trail baselines exist to provide,
    so Archive is the only removal path available for it.
    """
    activity = await get_activity(db, activity_id)
    await _require_live_period(db, activity.period_id)
    if activity.is_archive_container:
        raise HTTPException(status_code=422, detail="The Archived container can't be deleted")
    period_id = activity.period_id

    doomed_ids = {activity_id} if cascade is False else await _subtree_ids(db, period_id, activity_id)

    if await _has_baseline_history(db, doomed_ids):
        await archive_activity(db, activity_id, cascade=cascade)
        return True

    # Explicitly ORM-delete any activity_relationships touching the row(s) about to be
    # removed *before* the activity delete, rather than leaning on the FK's ON DELETE
    # CASCADE alone. A DB-level cascade the ORM doesn't know about leaves a dangling,
    # merely-expired ActivityRelationship object (it holds FK columns) in the session's
    # identity map; a later unrelated query's autoflush pass touching that object's
    # expired FK attributes raises MissingGreenlet trying to refresh a row that no
    # longer exists. Doing the delete explicitly keeps the session's own state honest.
    rel_result = await db.execute(
        select(ActivityRelationship).where(
            or_(
                ActivityRelationship.predecessor_id.in_(doomed_ids),
                ActivityRelationship.successor_id.in_(doomed_ids),
            )
        )
    )
    for rel in rel_result.scalars().all():
        await db.delete(rel)
    await db.commit()

    # A schedule-managed cost element (Resources module) has no meaning once its
    # activity is gone — clean it up explicitly rather than leaving an orphaned,
    # still-budgeted line behind. Manually-unlinked elements are left alone, same
    # rule as everywhere else in app/services/cost_sync.py.
    for doomed_id in doomed_ids:
        await cost_sync.delete_linked_cost_element(db, doomed_id)

    if not cascade:
        result = await db.execute(select(Activity).where(Activity.parent_id == activity_id))
        children = list(result.scalars().all())
        for child in children:
            child.parent_id = activity.parent_id
            child.sort_order = await _next_sibling_sort_order(
                db, period_id, activity.parent_id, exclude_id=child.id
            )
        await db.commit()

    # ON DELETE CASCADE (see app/models/activity.py) removes any remaining descendants
    # at the DB level — none left if cascade=False since they were just reparented away.
    # The ORM has no idea a DB-level cascade happened — only `activity` was explicitly
    # session.delete()'d — so any cascade-deleted descendants stay as stale "alive"
    # objects in the session's identity map afterward. expunge_all() (not expire_all())
    # detaches every object from the session without invalidating their already-loaded
    # attribute values — objects like the test/request-scoped Project or Period fixtures
    # that nothing here ever touches again stay perfectly readable off their last-known
    # values. expire_all() instead marks every attribute on every session object as
    # needing a fresh reload on next touch; if an unrelated later query's autoflush
    # pass ends up dirty-checking one of those expired objects mid-flight (observed with
    # ActivityRelationship's FK columns above before this was extracted into its own
    # explicit delete), reloading it requires a *nested* DB round-trip that the async
    # driver can't service from inside another one, raising MissingGreenlet.
    await db.delete(activity)
    await db.commit()
    db.expunge_all()
    await _recompute_hierarchy(db, period_id)
    await scheduling_cpm.recompute_schedule(db, period_id)
    return False
