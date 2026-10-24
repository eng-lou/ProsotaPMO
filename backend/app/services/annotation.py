from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.annotation import Annotation, AnnotationMedia
from app.schemas.annotation import AnnotationCreate, AnnotationResponse, AnnotationUpdate


async def list_annotations(db: AsyncSession, project_id: uuid.UUID) -> list[AnnotationResponse]:
    rows = (await db.execute(
        select(Annotation).where(Annotation.project_id == project_id).order_by(Annotation.created_at)
    )).scalars().all()
    return [AnnotationResponse.model_validate(r) for r in rows]


async def create_annotation(db: AsyncSession, data: AnnotationCreate) -> AnnotationResponse:
    await validate_media(db, data.project_id, data.callout)
    row = Annotation(**data.model_dump(mode="json"))
    row.project_id = data.project_id
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return AnnotationResponse.model_validate(row)


async def update_annotation(db: AsyncSession, annotation_id: uuid.UUID, data: AnnotationUpdate) -> AnnotationResponse:
    row = await db.get(Annotation, annotation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if data.callout is not None:
        await validate_media(db, row.project_id, data.callout)
    for field, value in data.model_dump(exclude_unset=True, mode="json").items():
        if field == "callout" and value is None:
            value = {}
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return AnnotationResponse.model_validate(row)


async def delete_annotation(db: AsyncSession, annotation_id: uuid.UUID) -> None:
    row = await db.get(Annotation, annotation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Annotation not found")
    await db.delete(row)
    await db.commit()


async def validate_media(db, project_id, content):
    if not content.media_id:
        return
    media = await db.get(AnnotationMedia, content.media_id)
    if not media or media.project_id != project_id or not media.ready:
        raise HTTPException(422, "Choose media uploaded to this project")
    expected = "video/" if content.mode == "video" else "image/"
    if not media.content_type.startswith(expected):
        raise HTTPException(422, "Media type does not match this callout")
