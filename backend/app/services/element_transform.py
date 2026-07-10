from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.element_transform import ElementTransform
from app.models.model3d_file import Model3DFile
from app.schemas.element_transform import ElementTransformResponse, ElementTransformSave


async def list_transforms(db: AsyncSession, project_id: uuid.UUID) -> list[ElementTransformResponse]:
    rows = (await db.execute(
        select(ElementTransform).where(ElementTransform.project_id == project_id)
    )).scalars().all()
    return [ElementTransformResponse.model_validate(r) for r in rows]


# Upsert, not create-then-separately-update: a gizmo drag or a Properties
# panel field edit just wants "save wherever this object/element currently
# is," not a distinct create-vs-update decision the frontend has to track
# per target (2026-07-11).
async def save_transform(db: AsyncSession, data: ElementTransformSave) -> ElementTransformResponse:
    model_file = await db.get(Model3DFile, data.model3d_file_id)
    if model_file is None:
        raise HTTPException(status_code=404, detail="Model file not found")

    existing = (await db.execute(
        select(ElementTransform).where(
            ElementTransform.model3d_file_id == data.model3d_file_id,
            ElementTransform.element_ref == data.element_ref,
        )
    )).scalar_one_or_none()

    if existing is not None:
        for field, value in data.model_dump(exclude={"model3d_file_id", "element_ref"}).items():
            setattr(existing, field, value)
        row = existing
    else:
        row = ElementTransform(project_id=model_file.project_id, **data.model_dump())
        db.add(row)

    await db.commit()
    await db.refresh(row)
    return ElementTransformResponse.model_validate(row)


async def delete_transform(db: AsyncSession, transform_id: uuid.UUID) -> None:
    row = await db.get(ElementTransform, transform_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Transform not found")
    await db.delete(row)
    await db.commit()
