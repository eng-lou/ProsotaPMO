from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.progress_variance_result import ProgressVarianceResult
from app.schemas.progress_variance_test import ProgressVarianceResultResponse, ProgressVarianceResultUpdate


async def update_result(db: AsyncSession, result_id: uuid.UUID, data: ProgressVarianceResultUpdate) -> ProgressVarianceResultResponse:
    row = await db.get(ProgressVarianceResult, result_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Progress variance result not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return ProgressVarianceResultResponse.model_validate(row)
