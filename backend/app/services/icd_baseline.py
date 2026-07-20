from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.icd_baseline import IcdBaseline, IcdBaselineItem
from app.models.icd_item import IcdItem
from app.models.period import Period
from app.schemas.icd_baseline import IcdBaselineCreate


async def _require_live_period(db: AsyncSession, period_id: uuid.UUID) -> None:
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    if period.freeze_status != "live":
        raise HTTPException(
            status_code=422,
            detail=f"Period '{period.period_label}' is {period.freeze_status}. Writes to frozen periods are not allowed.",
        )


async def _attach_item_counts(db: AsyncSession, baselines: list[IcdBaseline]) -> None:
    if not baselines:
        return
    result = await db.execute(
        select(IcdBaselineItem.baseline_id, func.count())
        .where(IcdBaselineItem.baseline_id.in_([b.id for b in baselines]))
        .group_by(IcdBaselineItem.baseline_id)
    )
    counts = dict(result.all())
    for b in baselines:
        b.item_count = counts.get(b.id, 0)


async def create_baseline(db: AsyncSession, data: IcdBaselineCreate) -> IcdBaseline:
    """Snapshots every issue/change/decision's current code/type/title/status
    under a new named, dated baseline — mirrors risk_baseline.py's own shape."""
    await _require_live_period(db, data.period_id)

    baseline = IcdBaseline(period_id=data.period_id, name=data.name, baseline_date=data.baseline_date)
    db.add(baseline)
    await db.flush()

    result = await db.execute(select(IcdItem).where(IcdItem.period_id == data.period_id))
    items = list(result.scalars().all())
    for item in items:
        db.add(IcdBaselineItem(
            baseline_id=baseline.id, icd_item_id=item.id, code=item.code,
            item_type=item.item_type, title=item.title, status=item.status,
        ))

    await db.commit()
    await db.refresh(baseline)
    baseline.item_count = len(items)
    return baseline


async def list_baselines(db: AsyncSession, period_id: uuid.UUID) -> list[IcdBaseline]:
    result = await db.execute(
        select(IcdBaseline).where(IcdBaseline.period_id == period_id)
        .order_by(IcdBaseline.baseline_date.desc(), IcdBaseline.created_at.desc())
    )
    baselines = list(result.scalars().all())
    await _attach_item_counts(db, baselines)
    return baselines


async def get_baseline_snapshot(db: AsyncSession, baseline_id: uuid.UUID) -> list[IcdBaselineItem]:
    baseline = await db.get(IcdBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    result = await db.execute(select(IcdBaselineItem).where(IcdBaselineItem.baseline_id == baseline_id))
    return list(result.scalars().all())


async def delete_baseline(db: AsyncSession, baseline_id: uuid.UUID) -> None:
    baseline = await db.get(IcdBaseline, baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    await _require_live_period(db, baseline.period_id)
    await db.delete(baseline)
    await db.commit()
