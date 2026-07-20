from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model3d_file import Model3DFile
from app.models.section_box import SectionBox
from app.schemas.section_box import SectionBoxCreate, SectionBoxResponse, SectionBoxUpdate


async def list_section_boxes(db: AsyncSession, project_id: uuid.UUID) -> list[SectionBoxResponse]:
    rows = (await db.execute(
        select(SectionBox).where(SectionBox.project_id == project_id).order_by(SectionBox.created_at)
    )).scalars().all()
    return [SectionBoxResponse.model_validate(r) for r in rows]


async def create_section_box(db: AsyncSession, data: SectionBoxCreate) -> SectionBoxResponse:
    model_file = await db.get(Model3DFile, data.model3d_file_id)
    if model_file is None:
        raise HTTPException(status_code=404, detail="Model file not found")

    row = SectionBox(
        project_id=model_file.project_id,
        model3d_file_id=data.model3d_file_id,
        element_ref=data.element_ref,
        name=data.name,
        min_x=data.min_x, min_y=data.min_y, min_z=data.min_z,
        max_x=data.max_x, max_y=data.max_y, max_z=data.max_z,
        rot_x=data.rot_x, rot_y=data.rot_y, rot_z=data.rot_z,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return SectionBoxResponse.model_validate(row)


async def update_section_box(db: AsyncSession, box_id: uuid.UUID, data: SectionBoxUpdate) -> SectionBoxResponse:
    row = await db.get(SectionBox, box_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Section box not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return SectionBoxResponse.model_validate(row)


async def delete_section_box(db: AsyncSession, box_id: uuid.UUID) -> None:
    row = await db.get(SectionBox, box_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Section box not found")
    await db.delete(row)
    await db.commit()
