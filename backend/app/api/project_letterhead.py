from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.project_letterhead import ProjectLetterheadResponse, ProjectLetterheadUpsert
from app.services import project_letterhead as svc

router = APIRouter(prefix="/letterhead", tags=["letterhead"])


@router.get("/", response_model=ProjectLetterheadResponse)
async def get_letterhead(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Shared header/footer/logo used by every module's print view for this
    project. Returns an in-memory default (matching the print views' original
    fixed header) if nothing has been saved yet — never a 404."""
    return await svc.get_or_default(db, project_id)


@router.put("/", response_model=ProjectLetterheadResponse)
async def save_letterhead(
    data: ProjectLetterheadUpsert,
    db: AsyncSession = Depends(get_db),
):
    return await svc.upsert(db, data)
