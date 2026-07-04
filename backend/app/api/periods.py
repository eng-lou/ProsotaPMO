from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_db_user
from app.database import get_db
from app.models.period import Period
from app.models.project import Project
from app.schemas.period import PeriodCreate, PeriodResponse, PeriodUpdate

router = APIRouter(prefix="/periods", tags=["periods"])


async def _get_period_checked(
    period_id: uuid.UUID,
    db: AsyncSession,
    current_user,
) -> Period:
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    project = await db.get(Project, period.project_id)
    if project is None or project.org_id != current_user.org_id:
        raise HTTPException(status_code=404, detail="Period not found")
    return period


@router.get("/", response_model=list[PeriodResponse])
async def list_periods(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
) -> list:
    project = await db.get(Project, project_id)
    if project is None or project.org_id != current_user.org_id:
        raise HTTPException(status_code=404, detail="Project not found")
    result = await db.execute(
        select(Period).where(Period.project_id == project_id).order_by(Period.created_at)
    )
    return list(result.scalars().all())


@router.post("/", response_model=PeriodResponse, status_code=201)
async def create_period(
    data: PeriodCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
):
    project = await db.get(Project, data.project_id)
    if project is None or project.org_id != current_user.org_id:
        raise HTTPException(status_code=404, detail="Project not found")
    period = Period(**data.model_dump())
    db.add(period)
    await db.commit()
    await db.refresh(period)
    return period


# Registered ahead of any client-side find-or-create logic (the previous
# approach, in frontend/src/lib/usePeriod.ts) — two concurrent calls for a
# project with no periods yet would both see an empty list and both create
# a "Period 1", silently splitting that project's data across two "live"
# periods with no guarantee which one the app would treat as active on any
# given load (found for real: two rows ~1.5ms apart, see migration
# a3f9c02e5b71). This does the whole find-or-create as one atomic call,
# relying on the DB's own partial unique index (one live period per
# project) as the actual race guard — a losing concurrent request gets an
# IntegrityError here, which just means it re-fetches the winner instead.
@router.post("/bootstrap", response_model=PeriodResponse)
async def bootstrap_period(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
):
    project = await db.get(Project, project_id)
    if project is None or project.org_id != current_user.org_id:
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(Period).where(Period.project_id == project_id).order_by(Period.created_at)
    )
    periods = list(result.scalars().all())
    active = next((p for p in periods if p.freeze_status == "live"), None) or (periods[0] if periods else None)
    if active is not None:
        return active

    period = Period(project_id=project_id, period_label="Period 1", freeze_status="live")
    db.add(period)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        result = await db.execute(
            select(Period).where(Period.project_id == project_id, Period.freeze_status == "live")
        )
        return result.scalar_one()
    await db.refresh(period)
    return period


@router.get("/{period_id}", response_model=PeriodResponse)
async def get_period(
    period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
):
    return await _get_period_checked(period_id, db, current_user)


@router.patch("/{period_id}", response_model=PeriodResponse)
async def update_period(
    period_id: uuid.UUID,
    data: PeriodUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
):
    period = await _get_period_checked(period_id, db, current_user)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(period, field, value)
    await db.commit()
    await db.refresh(period)
    return period


@router.delete("/{period_id}", status_code=204)
async def delete_period(
    period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
) -> Response:
    period = await _get_period_checked(period_id, db, current_user)
    await db.delete(period)
    await db.commit()
    return Response(status_code=204)
