from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.progress_variance_test import (
    ActivityProgressSuggestion,
    ProgressVarianceResultElement,
    ProgressVarianceTestCreate,
    ProgressVarianceTestResponse,
    ProgressVarianceTestUpdate,
)
from app.services import progress_variance_test as svc

router = APIRouter(prefix="/progress-variance-tests", tags=["progress-variance-tests"])


@router.get("/", response_model=list[ProgressVarianceTestResponse])
async def list_tests(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_tests(db, project_id)


@router.post("/", response_model=ProgressVarianceTestResponse, status_code=201)
async def create_test(
    data: ProgressVarianceTestCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_test(db, data)


@router.patch("/{test_id}", response_model=ProgressVarianceTestResponse)
async def update_test(
    test_id: uuid.UUID,
    data: ProgressVarianceTestUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_test(db, test_id, data)


@router.delete("/{test_id}", status_code=204)
async def delete_test(
    test_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_test(db, test_id)
    return Response(status_code=204)


@router.put("/{test_id}/results", response_model=ProgressVarianceTestResponse)
async def replace_results(
    test_id: uuid.UUID,
    elements: list[ProgressVarianceResultElement],
    db: AsyncSession = Depends(get_db),
):
    return await svc.replace_results(db, test_id, elements)


@router.get("/{test_id}/activity-progress-suggestions", response_model=list[ActivityProgressSuggestion])
async def activity_progress_suggestions(
    test_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.suggest_activity_progress(db, test_id)
