from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import scheduling_quality as svc

router = APIRouter(prefix="/scheduling-quality", tags=["scheduling-quality"])


@router.get("/")
async def get_quality(
    period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await svc.compute_quality(db, period_id)
