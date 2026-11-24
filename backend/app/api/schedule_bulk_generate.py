from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.repeat_floor_cycle import RepeatCycle, repeat_cycle
from app.database import get_db
from app.core.auth import get_db_user
from app.services.clash_access import owned_project
from app.schemas.schedule_bulk_generate import ScheduleBulkGenerateRequest, ScheduleBulkGenerateResponse
from app.services import schedule_bulk_generate as svc

router = APIRouter(prefix="/schedule-bulk-generate", tags=["schedule-bulk-generate"])


@router.post("/repeat-floor")
async def repeat_floor(data: RepeatCycle, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_project(db, data.project_id, user)
    try:
        # Existing CPM and hierarchy helpers commit their session. Join the
        # request transaction so the floor, links and dates become visible together.
        connection = await db.connection()
        async with AsyncSession(bind=connection, join_transaction_mode="rollback_only", expire_on_commit=False) as work:
            result = await repeat_cycle(work, data)
        await db.commit()
        return result
    except Exception:
        await db.rollback()
        raise


@router.post("/", response_model=ScheduleBulkGenerateResponse, status_code=201)
async def bulk_generate(
    data: ScheduleBulkGenerateRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_db_user),
):
    await owned_project(db, data.project_id, user)
    return await svc.bulk_generate(db, data)
