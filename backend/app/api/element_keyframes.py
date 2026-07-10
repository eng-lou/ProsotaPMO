from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.element_keyframe import ElementKeyframeResponse, ElementKeyframeUpsert
from app.services import element_keyframe as svc

router = APIRouter(prefix="/element-keyframes", tags=["element-keyframes"])


@router.get("/", response_model=list[ElementKeyframeResponse])
async def list_keyframes(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_keyframes(db, project_id)


@router.post("/", response_model=ElementKeyframeResponse, status_code=201)
async def upsert_keyframe(
    data: ElementKeyframeUpsert,
    db: AsyncSession = Depends(get_db),
):
    """Inserts a new keyframe, or overwrites the value of an existing one at
    the exact same (element, field, date) — re-keying the same spot updates
    it rather than erroring."""
    return await svc.upsert_keyframe(db, data)


@router.delete("/{keyframe_id}", status_code=204)
async def delete_keyframe(
    keyframe_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_keyframe(db, keyframe_id)
    return Response(status_code=204)
