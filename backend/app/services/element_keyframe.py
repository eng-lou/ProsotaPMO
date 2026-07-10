from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.element_keyframe import ElementKeyframe
from app.schemas.element_keyframe import ElementKeyframeResponse, ElementKeyframeUpsert


async def list_keyframes(db: AsyncSession, project_id: uuid.UUID) -> list[ElementKeyframeResponse]:
    rows = (await db.execute(
        select(ElementKeyframe).where(ElementKeyframe.project_id == project_id).order_by(ElementKeyframe.date)
    )).scalars().all()
    return [ElementKeyframeResponse.model_validate(r) for r in rows]


async def upsert_keyframe(db: AsyncSession, data: ElementKeyframeUpsert) -> ElementKeyframeResponse:
    existing = (await db.execute(
        select(ElementKeyframe).where(
            ElementKeyframe.project_id == data.project_id,
            ElementKeyframe.source_kind == data.source_kind,
            ElementKeyframe.element_ref == data.element_ref,
            ElementKeyframe.field == data.field,
            ElementKeyframe.date == data.date,
        )
    )).scalar_one_or_none()

    if existing is not None:
        existing.value = data.value
        row = existing
    else:
        row = ElementKeyframe(**data.model_dump())
        db.add(row)

    await db.commit()
    await db.refresh(row)
    return ElementKeyframeResponse.model_validate(row)


async def delete_keyframe(db: AsyncSession, keyframe_id: uuid.UUID) -> None:
    row = await db.get(ElementKeyframe, keyframe_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Keyframe not found")
    await db.delete(row)
    await db.commit()
