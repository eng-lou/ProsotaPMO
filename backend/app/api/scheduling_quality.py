from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.scheduling_quality import QualityReport
from app.services import scheduling_quality as svc

router = APIRouter(prefix="/scheduling-quality", tags=["scheduling-quality"])


@router.get("/", response_model=QualityReport)
async def get_quality(
    schedule_period_id: uuid.UUID,
    scope_subproject_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await svc.compute_quality(db, schedule_period_id, scope_subproject_id)
