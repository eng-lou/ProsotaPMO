from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.element_parent import ElementParentCreate, ElementParentResponse
from app.services import element_parent as svc

router = APIRouter(prefix="/element-parents", tags=["element-parents"])


@router.get("/", response_model=list[ElementParentResponse])
async def list_element_parents(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_element_parents(db, project_id)


# PUT, not POST (2026-07-12) — matches path_followers.py's own PUT/upsert
# reasoning: re-parenting re-points an existing binding rather than
# duplicating it, which is idempotent-replace, not "create a new thing."
@router.put("/", response_model=ElementParentResponse)
async def upsert_element_parent(
    data: ElementParentCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.upsert_element_parent(db, data)


@router.delete("/{element_parent_id}", status_code=204)
async def delete_element_parent(
    element_parent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_element_parent(db, element_parent_id)
    return Response(status_code=204)
