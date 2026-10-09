from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.auth import get_db_user
from app.services.clash_access import owned_test
from app.models.clash_result import ClashResult
from app.schemas.clash_test import ClashResultResponse, ClashResultUpdate
from app.services import clash_result as svc

router = APIRouter(prefix="/clash-results", tags=["clash-results"])


@router.patch("/{result_id}", response_model=ClashResultResponse)
async def update_clash_result(
    result_id: uuid.UUID,
    data: ClashResultUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_db_user),
):
    result = await db.get(ClashResult, result_id)
    if not result:
        raise HTTPException(404, "Clash not found")
    await owned_test(db, result.clash_test_id, user, lock=True)
    await db.refresh(result)
    return await svc.update_clash_result(db, result_id, data)
