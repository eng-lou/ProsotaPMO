from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.cost_bulk_generate import CostBulkGenerateRequest, CostBulkGenerateResponse
from app.services import cost_bulk_generate as svc

router = APIRouter(prefix="/cost-bulk-generate", tags=["cost-bulk-generate"])


@router.post("/", response_model=CostBulkGenerateResponse, status_code=201)
async def bulk_generate(
    data: CostBulkGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    return await svc.bulk_generate(db, data)
