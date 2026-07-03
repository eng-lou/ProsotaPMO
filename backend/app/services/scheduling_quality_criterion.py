from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduling_quality_criterion import SchedulingQualityCriterion
from app.schemas.scheduling_quality_criterion import SchedulingQualityCriterionUpdate

# Matches the hardcoded literals in app/services/scheduling_quality.py exactly
# — checks 1-11 only (percentage-threshold checks); 12 (Critical Path Test)
# has no numeric threshold and is never represented here.
DEFAULT_THRESHOLDS: dict[int, str] = {
    1: "5.00", 2: "5.00", 3: "10.00", 4: "5.00", 5: "0.00",
    6: "5.00", 7: "0.00", 8: "5.00", 9: "5.00", 10: "0.00", 11: "5.00",
}


async def _seed(db: AsyncSession, project_id: uuid.UUID) -> list[SchedulingQualityCriterion]:
    rows = [
        SchedulingQualityCriterion(project_id=project_id, check_number=n, threshold=t)
        for n, t in DEFAULT_THRESHOLDS.items()
    ]
    db.add_all(rows)
    await db.commit()
    for r in rows:
        await db.refresh(r)
    return rows


async def list_criteria(db: AsyncSession, project_id: uuid.UUID) -> list[SchedulingQualityCriterion]:
    result = await db.execute(
        select(SchedulingQualityCriterion)
        .where(SchedulingQualityCriterion.project_id == project_id)
        .order_by(SchedulingQualityCriterion.check_number)
    )
    rows = list(result.scalars().all())
    return rows if rows else await _seed(db, project_id)


async def thresholds_by_check(db: AsyncSession, project_id: uuid.UUID) -> dict[int, float]:
    """What app/services/scheduling_quality.py actually consumes — a plain
    {check_number: threshold} map, seeding defaults on first use same as
    list_criteria."""
    rows = await list_criteria(db, project_id)
    return {r.check_number: float(r.threshold) for r in rows}


async def update_criterion(
    db: AsyncSession, criterion_id: uuid.UUID, data: SchedulingQualityCriterionUpdate
) -> SchedulingQualityCriterion:
    criterion = await db.get(SchedulingQualityCriterion, criterion_id)
    if criterion is None:
        raise HTTPException(status_code=404, detail="Quality criterion not found")
    criterion.threshold = data.threshold
    await db.commit()
    await db.refresh(criterion)
    return criterion


async def reset_criteria(db: AsyncSession, project_id: uuid.UUID) -> list[SchedulingQualityCriterion]:
    await db.execute(delete(SchedulingQualityCriterion).where(SchedulingQualityCriterion.project_id == project_id))
    await db.commit()
    return await _seed(db, project_id)
