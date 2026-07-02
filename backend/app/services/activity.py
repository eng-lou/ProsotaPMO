from __future__ import annotations

import uuid
from collections import defaultdict
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.calendar import Calendar
from app.models.period import Period
from app.schemas.activity import ActivityCreate, ActivityUpdate, _validate_constraint
from app.services.reference_codes import next_code


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
    return _dfs_order(activities)


async def get_activity(db: AsyncSession, activity_id: uuid.UUID) -> Activity:
    activity = await db.get(Activity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


def _apply_computed_fields(activity: Activity) -> None:
    """Recompute the fields that are never accepted directly from clients.

    Per PMBOK7 / Rita Mulcahy Ch. 8 ("Schedule"): variance is finish vs. the
    captured baseline finish — meaningless (and left null) until a baseline
    actually exists. total_float/is_critical are outputs of the Critical Path
    Method's forward/backward pass, not opinions a user types in — same class
    of bug already fixed for Risk's EMV and Cost's CPI/SPI. Until Phase 5's
    CPM engine exists (docs/SCHEDULING_MODULE_PLAN.md), they stay honestly
    null rather than holding a fake or stale value.
    """
    activity.variance_days = (
        (activity.finish - activity.bl_finish).days
        if activity.finish is not None and activity.bl_finish is not None
        else None
    )
    activity.total_float = None
    activity.is_critical = None


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
    children = _build_children_map(activities)

    for a in activities:
        has_children = bool(children.get(a.id))
        if has_children and a.activity_type != "wbs_summary":
            a.activity_type = "wbs_summary"
        elif not has_children and a.activity_type == "wbs_summary":
            a.activity_type = "task"

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
        node.duration_days = (node.finish - node.start).days if node.start and node.finish else None
        weighted = [(k.pct_complete, k.duration_days or 0) for k in kids if k.pct_complete is not None]
        total_weight = sum(w for _, w in weighted)
        if weighted and total_weight > 0:
            node.pct_complete = sum(Decimal(str(p)) * w for p, w in weighted) / Decimal(total_weight)
        elif weighted:
            node.pct_complete = sum(Decimal(str(p)) for p, _ in weighted) / len(weighted)
        else:
            node.pct_complete = None
        _apply_computed_fields(node)

    # Flush + refresh every row this pass touched. Without this, an object mutated
    # here (e.g. a parent promoted to wbs_summary) keeps a server-computed column
    # (updated_at's onupdate=func.now()) expired in the session's identity map; the
    # next unrelated read of that same object in the same session — a later request
    # sharing this session, e.g. in tests — raises MissingGreenlet trying to lazily
    # refresh it outside an awaited context. Real request handling gets a fresh
    # session per call (app/database.py:get_db) so this is latent rather than a
    # request-facing bug today, but it's cheap to close properly.
    await db.commit()
    for a in activities:
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


async def create_activity(db: AsyncSession, data: ActivityCreate) -> Activity:
    await _require_live_period(db, data.period_id)

    if data.parent_id is not None:
        parent = await db.get(Activity, data.parent_id)
        if parent is None or parent.period_id != data.period_id:
            raise HTTPException(status_code=404, detail="Parent activity not found in this period")

    if data.calendar_id is not None:
        await _validate_calendar_in_project(db, data.calendar_id, data.project_id)

    next_sort_order = await _next_sibling_sort_order(db, data.period_id, data.parent_id)
    code = await next_code(db, Activity, "ACT", data.project_id)
    activity = Activity(**data.model_dump(), code=code, sort_order=next_sort_order)
    _apply_computed_fields(activity)
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    await _recompute_hierarchy(db, data.period_id)
    return activity


async def update_activity(
    db: AsyncSession, activity_id: uuid.UUID, data: ActivityUpdate
) -> Activity:
    activity = await get_activity(db, activity_id)
    await _require_live_period(db, activity.period_id)

    updates = data.model_dump(exclude_unset=True)
    if "parent_id" in updates and updates["parent_id"] is not None:
        result = await db.execute(select(Activity).where(Activity.period_id == activity.period_id))
        by_id = {a.id: a for a in result.scalars().all()}
        _validate_no_cycle(by_id, activity_id, updates["parent_id"])
        if updates["parent_id"] not in by_id:
            raise HTTPException(status_code=404, detail="Parent activity not found in this period")

    if updates.get("calendar_id") is not None:
        await _validate_calendar_in_project(db, updates["calendar_id"], activity.project_id)

    parent_changed = "parent_id" in updates and updates["parent_id"] != activity.parent_id
    for field, value in updates.items():
        setattr(activity, field, value)
    if parent_changed:
        activity.sort_order = await _next_sibling_sort_order(
            db, activity.period_id, activity.parent_id, exclude_id=activity.id
        )

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


async def delete_activity(db: AsyncSession, activity_id: uuid.UUID, cascade: bool = True) -> None:
    """Delete an activity. cascade=True (default) removes its whole WBS subtree too
    (MS Project's usual "delete summary task" behaviour). cascade=False deletes only
    this row and promotes its direct children up to its own level — they become
    siblings of what used to be this activity's siblings, per Maro's confirmed spec.
    """
    activity = await get_activity(db, activity_id)
    await _require_live_period(db, activity.period_id)
    period_id = activity.period_id

    # Explicitly ORM-delete any activity_relationships touching the row(s) about to be
    # removed *before* the activity delete, rather than leaning on the FK's ON DELETE
    # CASCADE alone. A DB-level cascade the ORM doesn't know about leaves a dangling,
    # merely-expired ActivityRelationship object (it holds FK columns) in the session's
    # identity map; a later unrelated query's autoflush pass touching that object's
    # expired FK attributes raises MissingGreenlet trying to refresh a row that no
    # longer exists. Doing the delete explicitly keeps the session's own state honest.
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
