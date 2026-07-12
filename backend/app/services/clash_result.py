from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.clash_result import ClashResult
from app.schemas.clash_test import ClashResultResponse, ClashResultUpdate


async def update_clash_result(db: AsyncSession, result_id: uuid.UUID, data: ClashResultUpdate) -> ClashResultResponse:
    row = await db.get(ClashResult, result_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Clash result not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return ClashResultResponse.model_validate(row)
