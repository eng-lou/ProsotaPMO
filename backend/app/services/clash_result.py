from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.clash_result import ClashResult
from app.schemas.clash_test import ClashResultResponse, ClashResultUpdate


async def update_clash_result(db: AsyncSession, result_id: uuid.UUID, data: ClashResultUpdate) -> ClashResultResponse:
    row = await db.get(ClashResult, result_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Clash result not found")

    changes = data.model_dump(exclude_unset=True)
    if "status" in changes and changes["status"] is None:
        raise HTTPException(422, "Status cannot be null")
    if changes:
        row.review_history = [*row.review_history, {"at": datetime.now(timezone.utc).isoformat(), "before": {"status": row.status, "comment": row.comment}, "changes": changes}]
    for field, value in changes.items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return ClashResultResponse.model_validate(row)
