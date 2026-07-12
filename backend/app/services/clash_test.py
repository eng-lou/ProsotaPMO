from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.clash_result import ClashResult
from app.models.clash_test import ClashTest
from app.schemas.clash_test import ClashResultPair, ClashResultResponse, ClashTestCreate, ClashTestResponse, ClashTestUpdate


def _to_response(row: ClashTest, results: list[ClashResult]) -> ClashTestResponse:
    return ClashTestResponse(
        id=row.id, project_id=row.project_id, name=row.name,
        group_a_collection_id=row.group_a_collection_id, group_b_collection_id=row.group_b_collection_id,
        test_type=row.test_type, tolerance_mm=row.tolerance_mm, last_run_at=row.last_run_at,
        created_at=row.created_at, updated_at=row.updated_at,
        results=[ClashResultResponse.model_validate(r) for r in results],
    )


async def _results_for(db: AsyncSession, clash_test_id: uuid.UUID) -> list[ClashResult]:
    return list((await db.execute(
        select(ClashResult).where(ClashResult.clash_test_id == clash_test_id).order_by(ClashResult.created_at)
    )).scalars().all())


async def list_clash_tests(db: AsyncSession, project_id: uuid.UUID) -> list[ClashTestResponse]:
    tests = list((await db.execute(
        select(ClashTest).where(ClashTest.project_id == project_id).order_by(ClashTest.created_at)
    )).scalars().all())

    results_by_test: dict[uuid.UUID, list[ClashResult]] = {t.id: [] for t in tests}
    if tests:
        result_rows = (await db.execute(
            select(ClashResult)
            .where(ClashResult.clash_test_id.in_([t.id for t in tests]))
            .order_by(ClashResult.created_at)
        )).scalars().all()
        for r in result_rows:
            results_by_test[r.clash_test_id].append(r)

    return [_to_response(t, results_by_test[t.id]) for t in tests]


async def create_clash_test(db: AsyncSession, data: ClashTestCreate) -> ClashTestResponse:
    row = ClashTest(
        project_id=data.project_id, name=data.name,
        group_a_collection_id=data.group_a_collection_id, group_b_collection_id=data.group_b_collection_id,
        test_type=data.test_type, tolerance_mm=data.tolerance_mm,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_response(row, [])


async def update_clash_test(db: AsyncSession, clash_test_id: uuid.UUID, data: ClashTestUpdate) -> ClashTestResponse:
    row = await db.get(ClashTest, clash_test_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Clash test not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return _to_response(row, await _results_for(db, clash_test_id))


async def delete_clash_test(db: AsyncSession, clash_test_id: uuid.UUID) -> None:
    row = await db.get(ClashTest, clash_test_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Clash test not found")
    await db.delete(row)
    await db.commit()


async def replace_results(db: AsyncSession, clash_test_id: uuid.UUID, pairs: list[ClashResultPair]) -> ClashTestResponse:
    """Bulk-replace this test's results with a freshly-computed set — see
    ClashResult's own docstring on why matching pairs keep their existing
    status/comment rather than every "Run Test" wiping prior review work."""
    test = await db.get(ClashTest, clash_test_id)
    if test is None:
        raise HTTPException(status_code=404, detail="Clash test not found")

    existing = await _results_for(db, clash_test_id)
    existing_by_pair = {(r.element_a_ref, r.element_b_ref): r for r in existing}
    incoming_pairs = {(p.element_a_ref, p.element_b_ref) for p in pairs}

    for r in existing:
        if (r.element_a_ref, r.element_b_ref) not in incoming_pairs:
            await db.delete(r)

    for p in pairs:
        key = (p.element_a_ref, p.element_b_ref)
        existing_row = existing_by_pair.get(key)
        if existing_row is not None:
            existing_row.element_a_source_kind = p.element_a_source_kind
            existing_row.element_a_label = p.element_a_label
            existing_row.element_b_source_kind = p.element_b_source_kind
            existing_row.element_b_label = p.element_b_label
            existing_row.distance_mm = p.distance_mm
        else:
            db.add(ClashResult(
                clash_test_id=clash_test_id,
                element_a_source_kind=p.element_a_source_kind, element_a_ref=p.element_a_ref, element_a_label=p.element_a_label,
                element_b_source_kind=p.element_b_source_kind, element_b_ref=p.element_b_ref, element_b_label=p.element_b_label,
                distance_mm=p.distance_mm, status="new",
            ))

    test.last_run_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(test)
    return _to_response(test, await _results_for(db, clash_test_id))
