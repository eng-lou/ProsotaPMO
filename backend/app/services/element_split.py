from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.element_split import ElementSplit
from app.schemas.element_split import ElementSplitCreate, ElementSplitResponse, ElementSplitUpdate


async def list_splits(db: AsyncSession, project_id: uuid.UUID) -> list[ElementSplitResponse]:
    rows = (await db.execute(
        select(ElementSplit).where(ElementSplit.project_id == project_id).order_by(ElementSplit.created_at)
    )).scalars().all()
    return [ElementSplitResponse.model_validate(r) for r in rows]


async def create_split(db: AsyncSession, data: ElementSplitCreate) -> ElementSplitResponse:
    existing = (await db.execute(
        select(ElementSplit).where(
            ElementSplit.project_id == data.project_id,
            ElementSplit.source_kind == data.source_kind,
            ElementSplit.element_ref == data.element_ref,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This element is already split — use PATCH to change its cut elevations")

    row = ElementSplit(
        project_id=data.project_id,
        source_kind=data.source_kind,
        element_ref=data.element_ref,
        cut_elevations_m=sorted(data.cut_elevations_m),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ElementSplitResponse.model_validate(row)


async def update_split(db: AsyncSession, split_id: uuid.UUID, data: ElementSplitUpdate) -> ElementSplitResponse:
    row = await db.get(ElementSplit, split_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Element split not found")
    row.cut_elevations_m = sorted(data.cut_elevations_m)
    await db.commit()
    await db.refresh(row)
    return ElementSplitResponse.model_validate(row)


async def delete_split(db: AsyncSession, split_id: uuid.UUID) -> None:
    row = await db.get(ElementSplit, split_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Element split not found")
    await db.delete(row)
    await db.commit()
