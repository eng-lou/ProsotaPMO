from __future__ import annotations

import uuid
import json
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
        if value is None:
            raise HTTPException(status_code=422, detail=f"{field} cannot be null")
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


async def replace_results(db: AsyncSession, clash_test_id: uuid.UUID, pairs: list[ClashResultPair], *, commit: bool = True, checked_keys: set[str] | None = None) -> ClashTestResponse:
    """Merge detections without deleting review work. Only verified coverage
    may resolve absent pairs; legacy callers cannot certify that coverage.
    """
    test = await db.get(ClashTest, clash_test_id)
    if test is None:
        raise HTTPException(status_code=404, detail="Clash test not found")

    existing = await _results_for(db, clash_test_id)
    # Qualify legacy IFC GUIDs only when the checked model identity is unique.
    # This keeps review notes when upgrading from the original GUID-only format.
    aliases = {}
    for key in checked_keys or []:
        kind, value = key.split(":", 1)
        if value.startswith("@model:"):
            try:
                raw = json.loads(value[7:])[1]
                aliases.setdefault((kind, raw), set()).add(value)
            except (ValueError, TypeError, IndexError):
                pass
    for row in existing:
        for side in ("a", "b"):
            kind, ref = getattr(row, f"element_{side}_source_kind"), getattr(row, f"element_{side}_ref")
            matches = aliases.get((kind, ref), set())
            if len(matches) == 1:
                setattr(row, f"element_{side}_ref", next(iter(matches)))
    existing_by_pair = {(r.element_a_source_kind, r.element_a_ref, r.element_b_source_kind, r.element_b_ref): r for r in existing}
    incoming_pairs = {(p.element_a_source_kind, p.element_a_ref, p.element_b_source_kind, p.element_b_ref) for p in pairs}

    incoming_pairs |= {(k[2], k[3], k[0], k[1]) for k in list(incoming_pairs)}
    for r in existing:
        if checked_keys is not None and f"{r.element_a_source_kind}:{r.element_a_ref}" in checked_keys and f"{r.element_b_source_kind}:{r.element_b_ref}" in checked_keys and (r.element_a_source_kind, r.element_a_ref, r.element_b_source_kind, r.element_b_ref) not in incoming_pairs:
            r.status = "resolved"

    seen = set()
    for p in pairs:
        if (p.element_a_source_kind, p.element_a_ref) == (p.element_b_source_kind, p.element_b_ref):
            raise HTTPException(status_code=422, detail="An element cannot clash with itself")
        pair_key = (p.element_a_source_kind, p.element_a_ref, p.element_b_source_kind, p.element_b_ref)
        if pair_key in seen or (pair_key[2], pair_key[3], pair_key[0], pair_key[1]) in seen:
            continue
        seen.add(pair_key)
        key = (p.element_a_source_kind, p.element_a_ref, p.element_b_source_kind, p.element_b_ref)
        existing_row = existing_by_pair.get(key) or existing_by_pair.get((key[2], key[3], key[0], key[1]))
        if existing_row is not None:
            if existing_row.status == "resolved":
                existing_row.status = "reopened"
            elif existing_row.status == "new":
                existing_row.status = "active"
            existing_row.element_a_ref = p.element_a_ref
            existing_row.element_b_ref = p.element_b_ref
            existing_row.element_a_source_kind = p.element_a_source_kind
            existing_row.element_a_label = p.element_a_label
            existing_row.element_b_source_kind = p.element_b_source_kind
            existing_row.element_b_label = p.element_b_label
            existing_row.distance_mm = p.distance_mm
            existing_row.element_metadata = p.element_metadata.model_dump(mode="json")
            existing_row.clash_point = list(p.clash_point) if p.clash_point else None
        else:
            db.add(ClashResult(
                clash_test_id=clash_test_id,
                element_a_source_kind=p.element_a_source_kind, element_a_ref=p.element_a_ref, element_a_label=p.element_a_label,
                element_b_source_kind=p.element_b_source_kind, element_b_ref=p.element_b_ref, element_b_label=p.element_b_label,
                element_metadata=p.element_metadata.model_dump(mode="json"), distance_mm=p.distance_mm, status="new", clash_point=list(p.clash_point) if p.clash_point else None,
            ))

    test.last_run_at = datetime.now(timezone.utc)
    await db.flush()
    if commit:
        await db.commit()
    await db.refresh(test)
    return _to_response(test, await _results_for(db, clash_test_id))
