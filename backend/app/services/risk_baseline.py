from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.models.risk import Risk
from app.models.risk_baseline import RiskBaseline, RiskBaselineItem
from app.schemas.risk_baseline import RiskBaselineCreate


async def _require_live_period(db: AsyncSession, period_id: uuid.UUID) -> None:
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    if period.freeze_status != "live":
        raise HTTPException(
            status_code=422,
            detail=f"Period '{period.period_label}' is {period.freeze_status}. Writes to frozen periods are not allowed.",
        )


async def _attach_item_counts(db: AsyncSession, baselines: list[RiskBaseline]) -> None:
    if not baselines:
        return
    result = await db.execute(
        select(RiskBaselineItem.baseline_id, func.count())
        .where(RiskBaselineItem.baseline_id.in_([b.id for b in baselines]))
        .group_by(RiskBaselineItem.baseline_id)
    )
    counts = dict(result.all())
    for b in baselines:
        b.item_count = counts.get(b.id, 0)


async def create_baseline(db: AsyncSession, data: RiskBaselineCreate) -> RiskBaseline:
    """Snapshots every risk's current code/title/status/rating/EMV under a
    new named, dated baseline — mirrors
    app/services/schedule_baseline.py:create_baseline's own shape. No
    assign/is_active step: Risk has no live bl_* columns a baseline needs to
    sync into, so capture is the whole action, not half of one."""
    await _require_live_period(db, data.period_id)

    baseline = RiskBaseline(period_id=data.period_id, name=data.name, baseline_date=data.baseline_date)
    db.add(baseline)
    await db.flush()

    result = await db.execute(select(Risk).where(Risk.period_id == data.period_id))
    risks = list(result.scalars().all())
    for r in risks:
        db.add(RiskBaselineItem(
            baseline_id=baseline.id, risk_id=r.id, code=r.code, title=r.title, status=r.status,
            rating=r.rating, emv_cost=r.emv_cost, emv_schedule_days=r.emv_schedule_days,
        ))

    await db.commit()
    await db.refresh(baseline)
    baseline.item_count = len(risks)
    return baseline


async def list_baselines(db: AsyncSession, period_id: uuid.UUID) -> list[RiskBaseline]:
    result = await db.execute(
        select(RiskBaseline).where(RiskBaseline.period_id == period_id)
        .order_by(RiskBaseline.baseline_date.desc(), RiskBaseline.created_at.desc())
    )
    baselines = list(result.scalars().all())
    await _attach_item_counts(db, baselines)
    return baselines


async def get_baseline_snapshot(db: AsyncSession, baseline_id: uuid.UUID) -> list[RiskBaselineItem]:
    baseline = await db.get(RiskBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    result = await db.execute(select(RiskBaselineItem).where(RiskBaselineItem.baseline_id == baseline_id))
    return list(result.scalars().all())


async def delete_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> None:
    baseline = await db.get(RiskBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_period(db, baseline.period_id)
    await db.delete(baseline)
    await db.commit()
