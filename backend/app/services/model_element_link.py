from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.model_element_link import ModelElementLink
from app.schemas.model_element_link import (
    ModelElementLinkBulkCreate,
    ModelElementLinkBulkResponse,
    ModelElementLinkCreate,
    ModelElementLinkResponse,
    ModelElementLinkUpdate,
)


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
        animation_profile_id=data.animation_profile_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ModelElementLinkResponse.model_validate(row)


async def create_links_bulk(db: AsyncSession, data: ModelElementLinkBulkCreate) -> ModelElementLinkBulkResponse:
    """One request, one Activity lookup, one duplicate check, one
    INSERT...RETURNING, one commit (2026-09-01, per Maro: "optimise and
    reduce waste, improve speed") — see CollectionMemberBulkCreate's own
    sibling in collection_member.py for the identical reasoning; this is
    the same fix for ModelElementLink's own equivalent one-at-a-time gap.
    """
    activity = await db.get(Activity, data.activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not data.members:
        return ModelElementLinkBulkResponse(created=[], skipped_duplicates=0)

    existing = (await db.execute(
        select(ModelElementLink.source_kind, ModelElementLink.element_ref).where(
            ModelElementLink.activity_id == data.activity_id,
        )
    )).all()
    existing_keys = {(sk, ref) for sk, ref in existing}

    seen_in_batch: set[tuple[str, str]] = set()
    to_insert: list[dict] = []
    skipped = 0
    for m in data.members:
        key = (m.source_kind, m.element_ref)
        if key in existing_keys or key in seen_in_batch:
            skipped += 1
            continue
        seen_in_batch.add(key)
        to_insert.append({
            "id": uuid.uuid4(), "project_id": activity.project_id, "activity_id": data.activity_id,
            "source_kind": m.source_kind, "element_ref": m.element_ref, "element_label": m.element_label,
            "animation_profile_id": data.animation_profile_id,
        })

    if not to_insert:
        return ModelElementLinkBulkResponse(created=[], skipped_duplicates=skipped)

    created = (await db.scalars(insert(ModelElementLink).returning(ModelElementLink), to_insert)).all()
    await db.commit()
    return ModelElementLinkBulkResponse(
        created=[ModelElementLinkResponse.model_validate(r) for r in created],
        skipped_duplicates=skipped,
    )


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
