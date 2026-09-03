from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost_element import CostElement
from app.models.cost_baseline import CostBaseline, CostBaselineItem
from app.models.period import Period
from app.schemas.cost_baseline import CostBaselineCreate
from app.services.cost_element import list_cost_elements


async def _require_live_period(db: AsyncSession, period_id: uuid.UUID) -> None:
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    if period.freeze_status != "live":
        raise HTTPException(
            status_code=422,
            detail=f"Period '{period.period_label}' is {period.freeze_status}. Writes to frozen periods are not allowed.",
        )


async def _attach_item_counts(db: AsyncSession, baselines: list[CostBaseline]) -> None:
    if not baselines:
        return
    result = await db.execute(
        select(CostBaselineItem.baseline_id, func.count())
        .where(CostBaselineItem.baseline_id.in_([b.id for b in baselines]))
        .group_by(CostBaselineItem.baseline_id)
    )
    counts = dict(result.all())
    for b in baselines:
        b.item_count = counts.get(b.id, 0)


async def create_baseline(db: AsyncSession, data: CostBaselineCreate) -> CostBaseline:
    """Snapshots every cost element's *resolved* BAC/AC/% complete under a new
    named, dated baseline — via the same list_cost_elements
    (app/services/cost_element.py) the dashboard's own KPI rollup already
    calls, so a percentage element's computed_budget/computed_actuals are
    resolved exactly once, consistently. Elements with no budget at all are
    skipped (no reference point to snapshot), same "no snapshot = no
    reference point" rule schedule_baseline.py's own promote path uses for
    activities created after a capture."""
    period = await db.get(Period, data.period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    await _require_live_period(db, data.period_id)

    baseline = CostBaseline(period_id=data.period_id, name=data.name, baseline_date=data.baseline_date)
    db.add(baseline)
    await db.flush()

    elements = await list_cost_elements(db, period.project_id, data.period_id)
    count = 0
    for el in elements:
        bac = el.computed_budget if el.element_type == "percentage" else el.budget
        ac = el.computed_actuals if el.element_type == "percentage" else el.actuals
        if bac is None:
            continue
        db.add(CostBaselineItem(
            baseline_id=baseline.id, cost_element_id=el.id, code=el.code, description=el.description,
            bac=bac, ac=ac, pct_complete=el.pct_complete,
        ))
        count += 1

    await db.commit()
    await db.refresh(baseline)
    baseline.item_count = count
    return baseline


async def list_baselines(db: AsyncSession, period_id: uuid.UUID) -> list[CostBaseline]:
    result = await db.execute(
        select(CostBaseline).where(CostBaseline.period_id == period_id)
        .order_by(CostBaseline.baseline_date.desc(), CostBaseline.created_at.desc())
    )
    baselines = list(result.scalars().all())
    await _attach_item_counts(db, baselines)
    return baselines


async def get_baseline_snapshot(db: AsyncSession, baseline_id: uuid.UUID) -> list[CostBaselineItem]:
    baseline = await db.get(CostBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    result = await db.execute(select(CostBaselineItem).where(CostBaselineItem.baseline_id == baseline_id))
    return list(result.scalars().all())


async def _clear_bl_budget(db: AsyncSession, period_id: uuid.UUID) -> list[CostElement]:
    """Nulls bl_budget on every cost element in a period — used whenever the
    period's active Cost Baseline goes away (deleted or unassigned) and BAC
    has no reference point left to reflect. Mirrors
    schedule_baseline.py:_clear_baseline_fields exactly, including the
    dirty-subset-only refresh (see that function's own docstring for why:
    avoids a synchronous re-fetch of an expired, server-computed updated_at
    outside an active greenlet)."""
    result = await db.execute(select(CostElement).where(CostElement.period_id == period_id))
    elements = list(result.scalars().all())
    for el in elements:
        el.bl_budget = None
    dirty_ids = {el.id for el in elements if db.is_modified(el)}
    await db.flush()
    for el in elements:
        if el.id in dirty_ids:
            await db.refresh(el)
    return elements


async def assign_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> list:
    """Copies a saved baseline's snapshot into bl_budget on every cost element
    in its period (2026-09-03, per Maro's domain correction — "the baseline
    of the figures becomes the approved budget... choose to assign a
    particular baseline as the budget figures to measure against"). Mirrors
    schedule_baseline.py:assign_baseline: a verbatim copy of
    CostBaselineItem.bac (already resolved once at capture time, percentage
    elements included — see create_baseline's own docstring), never a
    runtime re-cascade. An element created after the baseline was captured
    (no snapshot row) gets bl_budget cleared to null, same "no snapshot = no
    reference point" rule Schedule's own assign already applies.

    Also flips is_active: only one baseline per period is ever active at a
    time, so every other baseline in the same period gets is_active=False
    first."""
    baseline = await db.get(CostBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_period(db, baseline.period_id)

    siblings_result = await db.execute(select(CostBaseline).where(CostBaseline.period_id == baseline.period_id))
    for sibling in siblings_result.scalars().all():
        sibling.is_active = sibling.id == baseline.id

    snap_result = await db.execute(select(CostBaselineItem).where(CostBaselineItem.baseline_id == baseline_id))
    snapshots = {s.cost_element_id: s for s in snap_result.scalars().all()}

    elements_result = await db.execute(select(CostElement).where(CostElement.period_id == baseline.period_id))
    elements = list(elements_result.scalars().all())
    for el in elements:
        snap = snapshots.get(el.id)
        el.bl_budget = snap.bac if snap else None

    dirty_ids = {el.id for el in elements if db.is_modified(el)}
    await db.commit()
    for el in elements:
        if el.id in dirty_ids:
            await db.refresh(el)

    period = await db.get(Period, baseline.period_id)
    return await list_cost_elements(db, period.project_id, baseline.period_id)


async def unassign_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> list:
    """The opposite of assign_baseline: clears is_active without deleting the
    saved baseline, mirroring schedule_baseline.py:unassign_baseline. Every
    cost element's bl_budget clears exactly as if the baseline had been
    deleted, but it stays in the saved list to be assigned again later."""
    baseline = await db.get(CostBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_period(db, baseline.period_id)
    if not baseline.is_active:
        raise HTTPException(status_code=422, detail="This baseline isn't currently assigned")

    baseline.is_active = False
    await _clear_bl_budget(db, baseline.period_id)  # already flushed + refreshed
    await db.commit()

    period = await db.get(Period, baseline.period_id)
    return await list_cost_elements(db, period.project_id, baseline.period_id)


async def delete_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> None:
    baseline = await db.get(CostBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_period(db, baseline.period_id)

    if baseline.is_active:
        # Every cost element's bl_budget currently holds *this* baseline's
        # snapshot (assign_baseline copied it in) — with the baseline gone,
        # BAC has no reference point left and must clear, the same "no
        # snapshot = null, not stale" rule assign_baseline already applies to
        # elements created after a capture.
        await _clear_bl_budget(db, baseline.period_id)

    await db.delete(baseline)
    await db.commit()
