from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.risk_bulk_generate import RiskBulkGenerateRequest, RiskBulkGenerateResponse
from app.services import risk_bulk_generate as svc

router = APIRouter(prefix="/risk-bulk-generate", tags=["risk-bulk-generate"])


@router.post("/", response_model=RiskBulkGenerateResponse, status_code=201)
async def bulk_generate(
    data: RiskBulkGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    return await svc.bulk_generate(db, data)
