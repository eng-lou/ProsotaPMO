from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.model_element_link import ModelElementLink
from app.schemas.model_element_link import ModelElementLinkCreate, ModelElementLinkResponse, ModelElementLinkUpdate


async def list_links(db: AsyncSession, project_id: uuid.UUID) -> list[ModelElementLinkResponse]:
    rows = (await db.execute(
        select(ModelElementLink).where(ModelElementLink.project_id == project_id).order_by(ModelElementLink.created_at)
    )).scalars().all()
    return [ModelElementLinkResponse.model_validate(r) for r in rows]


async def create_link(db: AsyncSession, data: ModelElementLinkCreate) -> ModelElementLinkResponse:
    activity = await db.get(Activity, data.activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    existing = (await db.execute(
        select(ModelElementLink).where(
            ModelElementLink.activity_id == data.activity_id,
            ModelElementLink.source_kind == data.source_kind,
            ModelElementLink.element_ref == data.element_ref,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This element is already linked to this activity")

    row = ModelElementLink(
        project_id=activity.project_id,
        activity_id=data.activity_id,
        source_kind=data.source_kind,
        element_ref=data.element_ref,
        element_label=data.element_label,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ModelElementLinkResponse.model_validate(row)


async def update_link(db: AsyncSession, link_id: uuid.UUID, data: ModelElementLinkUpdate) -> ModelElementLinkResponse:
    row = await db.get(ModelElementLink, link_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Model element link not found")
    row.animation_profile_id = data.animation_profile_id
    await db.commit()
    await db.refresh(row)
    return ModelElementLinkResponse.model_validate(row)


async def delete_link(db: AsyncSession, link_id: uuid.UUID) -> None:
    row = await db.get(ModelElementLink, link_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Model element link not found")
    await db.delete(row)
    await db.commit()
