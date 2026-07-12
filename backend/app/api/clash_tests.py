from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.clash_test import ClashResultPair, ClashTestCreate, ClashTestResponse, ClashTestUpdate
from app.services import clash_test as svc

router = APIRouter(prefix="/clash-tests", tags=["clash-tests"])


@router.get("/", response_model=list[ClashTestResponse])
async def list_clash_tests(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_clash_tests(db, project_id)


@router.post("/", response_model=ClashTestResponse, status_code=201)
async def create_clash_test(
    data: ClashTestCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_clash_test(db, data)


@router.patch("/{clash_test_id}", response_model=ClashTestResponse)
async def update_clash_test(
    clash_test_id: uuid.UUID,
    data: ClashTestUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_clash_test(db, clash_test_id, data)


@router.delete("/{clash_test_id}", status_code=204)
async def delete_clash_test(
    clash_test_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_clash_test(db, clash_test_id)
    return Response(status_code=204)


@router.put("/{clash_test_id}/results", response_model=ClashTestResponse)
async def replace_clash_results(
    clash_test_id: uuid.UUID,
    pairs: list[ClashResultPair],
    db: AsyncSession = Depends(get_db),
):
    return await svc.replace_results(db, clash_test_id, pairs)
