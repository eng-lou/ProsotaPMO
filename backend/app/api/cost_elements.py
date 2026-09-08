from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.cost_element import CostElementCreate, CostElementResponse, CostElementUpdate, FyBreakdownResponse
from app.services import cost_element as svc

router = APIRouter(prefix="/cost-elements", tags=["cost-elements"])


@router.get("/", response_model=list[CostElementResponse])
async def list_cost_elements(
    project_id: uuid.UUID,
    period_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_cost_elements(db, project_id, period_id)


# Before /{element_id} — a static path segment must be matched first, or
# FastAPI would try (and fail) to parse "fy-breakdown" as a UUID.
@router.get("/fy-breakdown", response_model=FyBreakdownResponse)
async def get_fy_breakdown(
    project_id: uuid.UUID,
    period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.get_fy_breakdown(db, project_id, period_id)


@router.post("/", response_model=CostElementResponse, status_code=201)
async def create_cost_element(
    data: CostElementCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_cost_element(db, data)


@router.get("/{element_id}", response_model=CostElementResponse)
async def get_cost_element(
    element_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.get_cost_element(db, element_id)


@router.patch("/{element_id}", response_model=CostElementResponse)
async def update_cost_element(
    element_id: uuid.UUID,
    data: CostElementUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_cost_element(db, element_id, data)


@router.delete("/{element_id}", status_code=204)
async def delete_cost_element(
    element_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_cost_element(db, element_id)
    return Response(status_code=204)
