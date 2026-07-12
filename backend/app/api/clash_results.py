from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.clash_test import ClashResultResponse, ClashResultUpdate
from app.services import clash_result as svc

router = APIRouter(prefix="/clash-results", tags=["clash-results"])


@router.patch("/{result_id}", response_model=ClashResultResponse)
async def update_clash_result(
    result_id: uuid.UUID,
    data: ClashResultUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_clash_result(db, result_id, data)
