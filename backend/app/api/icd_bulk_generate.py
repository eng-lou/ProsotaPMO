from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.icd_bulk_generate import IcdBulkGenerateRequest, IcdBulkGenerateResponse
from app.services import icd_bulk_generate as svc

router = APIRouter(prefix="/icd-bulk-generate", tags=["icd-bulk-generate"])


@router.post("/", response_model=IcdBulkGenerateResponse)
async def bulk_generate(data: IcdBulkGenerateRequest, db: AsyncSession = Depends(get_db)):
    return await svc.bulk_generate(db, data)
