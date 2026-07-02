from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost_element import CostElement
from app.models.cost_rate_line import CostRateLine
from app.schemas.cost_rate_line import CostRateLineCreate, CostRateLineResponse, CostRateLineUpdate
from app.services.cost_element import _require_live_period


def _with_total(line: CostRateLine) -> CostRateLineResponse:
    data = CostRateLineResponse.model_validate(line)
    data.total = (Decimal(str(line.qty)) * Decimal(str(line.rate))).quantize(Decimal("0.01"))
    return data


async def _get_parent_element(db: AsyncSession, cost_element_id: uuid.UUID) -> CostElement:
    element = await db.get(CostElement, cost_element_id)
    if element is None:
        raise HTTPException(status_code=404, detail="Cost element not found")
    return element


async def list_rate_lines(db: AsyncSession, cost_element_id: uuid.UUID) -> list[CostRateLineResponse]:
    result = await db.execute(
        select(CostRateLine)
        .where(CostRateLine.cost_element_id == cost_element_id)
        .order_by(CostRateLine.created_at)
    )
    return [_with_total(line) for line in result.scalars().all()]


async def get_rate_line(db: AsyncSession, line_id: uuid.UUID) -> CostRateLine:
    line = await db.get(CostRateLine, line_id)
    if line is None:
        raise HTTPException(status_code=404, detail="Rate line not found")
    return line


async def _unlink_if_schedule_managed(db: AsyncSession, element: CostElement) -> None:
    """Resources module: rate lines under a schedule-managed element are normally
    maintained automatically (app/services/cost_sync.py, which writes directly to
    the ORM and never calls create/update/delete_rate_line). Reaching one of these
    functions means a user is editing the breakdown directly via Cost Plan's own
    UI — that permanently unlinks the parent element, per Maro's confirmed spec
    (docs/RESOURCES_MODULE_PLAN.md)."""
    if element.source == "schedule":
        element.source = "manual"


async def create_rate_line(db: AsyncSession, data: CostRateLineCreate) -> CostRateLineResponse:
    element = await _get_parent_element(db, data.cost_element_id)
    await _require_live_period(db, element.period_id)
    await _unlink_if_schedule_managed(db, element)
    line = CostRateLine(**data.model_dump())
    db.add(line)
    await db.commit()
    await db.refresh(line)
    return _with_total(line)


async def update_rate_line(
    db: AsyncSession, line_id: uuid.UUID, data: CostRateLineUpdate
) -> CostRateLineResponse:
    line = await get_rate_line(db, line_id)
    element = await _get_parent_element(db, line.cost_element_id)
    await _require_live_period(db, element.period_id)
    await _unlink_if_schedule_managed(db, element)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(line, field, value)
    await db.commit()
    await db.refresh(line)
    return _with_total(line)


async def delete_rate_line(db: AsyncSession, line_id: uuid.UUID) -> None:
    line = await get_rate_line(db, line_id)
    element = await _get_parent_element(db, line.cost_element_id)
    await _require_live_period(db, element.period_id)
    await _unlink_if_schedule_managed(db, element)
    await db.delete(line)
    await db.commit()
