from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost_element import CostElement
from app.models.period import Period
from app.schemas.cost_bulk_generate import CostBulkGenerateRequest, CostBulkGenerateResponse
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


async def bulk_generate(db: AsyncSession, data: CostBulkGenerateRequest) -> CostBulkGenerateResponse:
    await _require_live_period(db, data.period_id)

    to_create = data.elements
    if data.dedupe_by_description and data.elements:
        existing_result = await db.execute(
            select(CostElement.description).where(
                CostElement.project_id == data.project_id,
                CostElement.description.in_({e.description for e in data.elements}),
            )
        )
        existing_descriptions = {row[0] for row in existing_result.all()}
        to_create = [e for e in data.elements if e.description not in existing_descriptions]

    created_ids: list[uuid.UUID] = []
    for e in to_create:
        code = await next_code(db, CostElement, "CST", data.project_id)
        element = CostElement(
            id=uuid.uuid4(), project_id=data.project_id, period_id=data.period_id, code=code,
            element_type=e.element_type, rate=e.rate, element_group=e.element_group,
            description=e.description, cost_owner=e.cost_owner, source="manual",
        )
        db.add(element)
        created_ids.append(element.id)

    await db.commit()
    return CostBulkGenerateResponse(element_count=len(created_ids), element_ids=created_ids)
