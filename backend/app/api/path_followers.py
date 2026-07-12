from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.path_follower import PathFollowerCreate, PathFollowerResponse, PathFollowerUpdate
from app.services import path_follower as svc

router = APIRouter(prefix="/path-followers", tags=["path-followers"])


@router.get("/", response_model=list[PathFollowerResponse])
async def list_path_followers(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_path_followers(db, project_id)


# PUT, not POST (2026-07-11) — upsert_path_follower re-points an existing
# binding for the same target rather than erroring/duplicating, matching
# PUT's own idempotent-replace semantics better than POST's "create a new
# thing" connotation. See the service function's own docstring.
@router.put("/", response_model=PathFollowerResponse)
async def upsert_path_follower(
    data: PathFollowerCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.upsert_path_follower(db, data)


@router.patch("/{follower_id}", response_model=PathFollowerResponse)
async def update_path_follower(
    follower_id: uuid.UUID,
    data: PathFollowerUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_path_follower(db, follower_id, data)


@router.delete("/{follower_id}", status_code=204)
async def delete_path_follower(
    follower_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_path_follower(db, follower_id)
    return Response(status_code=204)
