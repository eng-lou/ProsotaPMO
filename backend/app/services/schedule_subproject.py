from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_code_history import ActivityCodeHistory
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_subproject import ScheduleSubproject
from app.schemas.schedule_subproject import ScheduleSubprojectCreate, ScheduleSubprojectResponse, ScheduleSubprojectUpdate


async def _recompute_live_period_for_root(db: AsyncSession, root_wbs_id: uuid.UUID) -> None:
    """Unlike app/services/calendar.py's own same-shaped helper — calendars are
    project-wide and so touch every schedule variant — a tagged sub-project's
    root_wbs_id is a specific Activity that lives in exactly one schedule
    variant (docs/SCHEDULE_VARIANTS_PLAN.md). Recomputing every variant's live
    period in the project would be wasted work (and, worse, would look like it
    silently "does nothing" for every variant that doesn't contain this root),
    so this scopes down to just the one live schedule period the tagged root
    actually belongs to. Local imports: scheduling_cpm already imports this
    module's sibling (calendar.py) for calendar lookups, so importing it back
    here at module level would be circular; activity.py is imported the same
    way for consistency.

    CPM first, then the hierarchy rollup — same order as
    app/services/activity_relationship.py:_recompute_period, since
    _recompute_hierarchy's WBS-summary rollup reads children's *computed*
    dates. _recompute_hierarchy is also what actually assigns the SP-####
    code (docs/SUBPROJECT_FLOAT_PLAN.md §E) — recompute_schedule alone only
    handles the float columns, never touches code/wbs_role."""
    from app.services import scheduling_cpm
    from app.services.activity import _recompute_hierarchy

    root = await db.get(Activity, root_wbs_id)
    if root is None:
        return
    period = await db.get(SchedulePeriod, root.schedule_period_id)
    if period is None or period.freeze_status != "live":
        return
    await scheduling_cpm.recompute_schedule(db, period.id, force_all_subprojects=True)
    await _recompute_hierarchy(db, period.id)


async def _log_untagged_root(db: AsyncSession, root_wbs_id: uuid.UUID) -> None:
    """Explicit audit-trail entry for the moment a sub-project's tag is
    removed. The code itself freezes at SP-#### permanently, like Archive
    (docs/SUBPROJECT_FLOAT_PLAN.md §E) — app/services/activity.py's
    _recompute_hierarchy deliberately skips any activity whose wbs_role is
    already "SP" from its own automatic renumber-and-log loop, so it would
    never otherwise notice or record that untagging happened at all. Same
    old_code/new_code (nothing about the code changes) — this row exists
    purely to answer "why does this still say SP-#### when it's not in the
    Sub-Projects list anymore" later."""
    root = await db.get(Activity, root_wbs_id)
    if root is not None and root.wbs_role == "SP":
        db.add(ActivityCodeHistory(
            activity_id=root.id, old_code=root.code, new_code=root.code, reason="untagged_subproject",
        ))
        await db.commit()


async def _validate_root_wbs(db: AsyncSession, project_id: uuid.UUID, root_wbs_id: uuid.UUID, exclude_subproject_id: uuid.UUID | None = None) -> None:
    root = await db.get(Activity, root_wbs_id)
    if root is None or root.project_id != project_id:
        raise HTTPException(status_code=404, detail="root_wbs_id is not an activity in this project.")
    # Only a nested WBS node (parent_id set) can be a sub-project root — not
    # the top-level project root itself (docs/SUBPROJECT_FLOAT_PLAN.md §E).
    if root.activity_type != "wbs_summary" or root.parent_id is None:
        raise HTTPException(status_code=422, detail="root_wbs_id must be a nested WBS summary node, not the top-level project root.")

    existing_result = await db.execute(
        select(ScheduleSubproject).where(
            ScheduleSubproject.project_id == project_id, ScheduleSubproject.root_wbs_id == root_wbs_id
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None and existing.id != exclude_subproject_id:
        raise HTTPException(status_code=422, detail="This WBS branch is already tagged as a sub-project.")


async def create_subproject(db: AsyncSession, data: ScheduleSubprojectCreate) -> ScheduleSubprojectResponse:
    await _validate_root_wbs(db, data.project_id, data.root_wbs_id)
    row = ScheduleSubproject(
        project_id=data.project_id, name=data.name,
        owning_party_org_id=data.owning_party_org_id, root_wbs_id=data.root_wbs_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await _recompute_live_period_for_root(db, data.root_wbs_id)
    return ScheduleSubprojectResponse.model_validate(row)


async def list_subprojects(db: AsyncSession, project_id: uuid.UUID) -> list[ScheduleSubprojectResponse]:
    rows = (await db.execute(
        select(ScheduleSubproject).where(ScheduleSubproject.project_id == project_id).order_by(ScheduleSubproject.created_at.desc())
    )).scalars().all()
    return [ScheduleSubprojectResponse.model_validate(r) for r in rows]


async def update_subproject(db: AsyncSession, subproject_id: uuid.UUID, data: ScheduleSubprojectUpdate) -> ScheduleSubprojectResponse:
    row = (await db.execute(select(ScheduleSubproject).where(ScheduleSubproject.id == subproject_id))).scalar_one()
    root_changed = row.root_wbs_id != data.root_wbs_id
    old_root_wbs_id = row.root_wbs_id
    if root_changed:
        await _validate_root_wbs(db, row.project_id, data.root_wbs_id, exclude_subproject_id=subproject_id)
    row.name = data.name
    row.owning_party_org_id = data.owning_party_org_id
    row.root_wbs_id = data.root_wbs_id
    await db.commit()
    await db.refresh(row)
    if root_changed:
        # Re-pointing to a different branch is "untag the old root, tag the
        # new one" — the new root's own SP-#### assignment falls out of the
        # recompute below automatically (_recompute_hierarchy), same as a
        # brand-new tag; the old root's freeze needs the explicit log though,
        # same as a plain delete. The old and new roots can sit in different
        # schedule variants entirely, so both their live periods need
        # recomputing, not just one.
        await _log_untagged_root(db, old_root_wbs_id)
        await _recompute_live_period_for_root(db, old_root_wbs_id)
        await _recompute_live_period_for_root(db, row.root_wbs_id)
    return ScheduleSubprojectResponse.model_validate(row)


async def delete_subproject(db: AsyncSession, subproject_id: uuid.UUID) -> None:
    row = (await db.execute(select(ScheduleSubproject).where(ScheduleSubproject.id == subproject_id))).scalar_one()
    root_wbs_id = row.root_wbs_id
    await db.delete(row)
    await db.commit()
    await _log_untagged_root(db, root_wbs_id)
    # Clears the branch's activities' sub_total_float_hours/sub_is_critical
    # back to null (see scheduling_cpm.py's own "no subprojects left" sweep) —
    # without this, untagging would leave stale, no-longer-meaningful numbers
    # showing until some unrelated edit happened to trigger a recompute.
    await _recompute_live_period_for_root(db, root_wbs_id)
