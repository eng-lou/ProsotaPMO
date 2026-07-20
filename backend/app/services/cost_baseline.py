from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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


async def delete_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> None:
    baseline = await db.get(CostBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_period(db, baseline.period_id)
    await db.delete(baseline)
    await db.commit()
