from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.site_context import SiteContext
from app.schemas.site_context import SiteContextResponse, SiteContextUpsert


async def get_or_default(db: AsyncSession, project_id: uuid.UUID) -> SiteContextResponse:
    row = (await db.execute(select(SiteContext).where(SiteContext.project_id == project_id))).scalar_one_or_none()
    if row is not None:
        return SiteContextResponse.model_validate(row)
    defaults = SiteContextUpsert(project_id=project_id)
    return SiteContextResponse(project_id=project_id, **defaults.model_dump(exclude={"project_id"}))


async def upsert(db: AsyncSession, data: SiteContextUpsert) -> SiteContextResponse:
    row = (await db.execute(select(SiteContext).where(SiteContext.project_id == data.project_id))).scalar_one_or_none()
    if row is None:
        row = SiteContext(project_id=data.project_id)
        db.add(row)
    for field, value in data.model_dump(exclude={"project_id"}).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return SiteContextResponse.model_validate(row)
