from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.progress_variance_test import ProgressVarianceResultResponse, ProgressVarianceResultUpdate
from app.services import progress_variance_result as svc

router = APIRouter(prefix="/progress-variance-results", tags=["progress-variance-results"])


@router.patch("/{result_id}", response_model=ProgressVarianceResultResponse)
async def update_result(
    result_id: uuid.UUID,
    data: ProgressVarianceResultUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_result(db, result_id, data)
