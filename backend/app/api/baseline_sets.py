from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.baseline_set import BaselineLinkUpdate, BaselineSetCreate, BaselineSetResponse, CaptureAllCreate
from app.services import baseline_set as svc

router = APIRouter(prefix="/baseline-sets", tags=["baseline-sets"])


@router.get("/", response_model=list[BaselineSetResponse])
async def list_baseline_sets(project_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list:
    return await svc.list_baseline_sets(db, project_id)


@router.post("/", response_model=BaselineSetResponse, status_code=201)
async def create_baseline_set(data: BaselineSetCreate, db: AsyncSession = Depends(get_db)):
    """A bare, empty BaselineSet — the frontend links already-existing
    standalone module baselines into it afterward, one /link call per
    module (BaselineComparison.tsx's own "Link Existing" flow)."""
    return await svc.create_baseline_set(db, data)


@router.post("/capture-all", response_model=BaselineSetResponse, status_code=201)
async def capture_all(data: CaptureAllCreate, db: AsyncSession = Depends(get_db)):
    """Captures a new Risk/Cost/ICD/Schedule baseline all at once, all tagged
    to a new named BaselineSet."""
    return await svc.capture_all(db, data)


@router.post("/link", status_code=204)
async def link_baseline(data: BaselineLinkUpdate, db: AsyncSession = Depends(get_db)) -> Response:
    """Attaches (baseline_set_id set) or detaches (baseline_set_id null) one
    already-existing standalone module baseline into a BaselineSet."""
    await svc.link_baseline(db, data)
    return Response(status_code=204)
