from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.auth import get_db_user
from app.services.clash_access import owned_project
from app.schemas.schedule_bulk_generate import ScheduleBulkGenerateRequest, ScheduleBulkGenerateResponse
from app.services import schedule_bulk_generate as svc

router = APIRouter(prefix="/schedule-bulk-generate", tags=["schedule-bulk-generate"])


@router.post("/", response_model=ScheduleBulkGenerateResponse, status_code=201)
async def bulk_generate(
    data: ScheduleBulkGenerateRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_db_user),
):
    await owned_project(db, data.project_id, user)
    return await svc.bulk_generate(db, data)
