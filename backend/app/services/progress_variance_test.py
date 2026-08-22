from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.model_element_link import ModelElementLink
from app.models.progress_variance_result import ProgressVarianceResult
from app.models.progress_variance_test import ProgressVarianceTest
from app.schemas.progress_variance_test import (
    ActivityProgressSuggestion,
    ProgressVarianceResultElement,
    ProgressVarianceResultResponse,
    ProgressVarianceTestCreate,
    ProgressVarianceTestResponse,
    ProgressVarianceTestUpdate,
)


def _to_response(row: ProgressVarianceTest, results: list[ProgressVarianceResult]) -> ProgressVarianceTestResponse:
    return ProgressVarianceTestResponse(
        id=row.id, project_id=row.project_id, name=row.name,
        group_a_collection_id=row.group_a_collection_id, site_capture_id=row.site_capture_id,
        min_coverage_percent=row.min_coverage_percent,
        last_run_at=row.last_run_at, created_at=row.created_at, updated_at=row.updated_at,
        results=[ProgressVarianceResultResponse.model_validate(r) for r in results],
    )


async def _results_for(db: AsyncSession, test_id: uuid.UUID) -> list[ProgressVarianceResult]:
    return list((await db.execute(
        select(ProgressVarianceResult).where(ProgressVarianceResult.progress_variance_test_id == test_id)
        .order_by(ProgressVarianceResult.created_at)
    )).scalars().all())


async def list_tests(db: AsyncSession, project_id: uuid.UUID) -> list[ProgressVarianceTestResponse]:
    tests = list((await db.execute(
        select(ProgressVarianceTest).where(ProgressVarianceTest.project_id == project_id)
        .order_by(ProgressVarianceTest.created_at)
    )).scalars().all())

    results_by_test: dict[uuid.UUID, list[ProgressVarianceResult]] = {t.id: [] for t in tests}
    if tests:
        result_rows = (await db.execute(
            select(ProgressVarianceResult)
            .where(ProgressVarianceResult.progress_variance_test_id.in_([t.id for t in tests]))
            .order_by(ProgressVarianceResult.created_at)
        )).scalars().all()
        for r in result_rows:
            results_by_test[r.progress_variance_test_id].append(r)

    return [_to_response(t, results_by_test[t.id]) for t in tests]


async def create_test(db: AsyncSession, data: ProgressVarianceTestCreate) -> ProgressVarianceTestResponse:
    row = ProgressVarianceTest(
        project_id=data.project_id, name=data.name,
        group_a_collection_id=data.group_a_collection_id, site_capture_id=data.site_capture_id,
        min_coverage_percent=data.min_coverage_percent,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_response(row, [])


async def update_test(db: AsyncSession, test_id: uuid.UUID, data: ProgressVarianceTestUpdate) -> ProgressVarianceTestResponse:
    row = await db.get(ProgressVarianceTest, test_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Progress variance test not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return _to_response(row, await _results_for(db, test_id))


async def delete_test(db: AsyncSession, test_id: uuid.UUID) -> None:
    row = await db.get(ProgressVarianceTest, test_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Progress variance test not found")
    await db.delete(row)
    await db.commit()


async def replace_results(
    db: AsyncSession, test_id: uuid.UUID, elements: list[ProgressVarianceResultElement],
) -> ProgressVarianceTestResponse:
    """Bulk-replace this test's results with a freshly-computed set — see
    ProgressVarianceResult's own docstring on why a matching element_ref
    keeps its existing status/comment rather than every "Run Test" wiping
    prior review work."""
    test = await db.get(ProgressVarianceTest, test_id)
    if test is None:
        raise HTTPException(status_code=404, detail="Progress variance test not found")

    existing = await _results_for(db, test_id)
    existing_by_ref = {r.element_ref: r for r in existing}
    incoming_refs = {e.element_ref for e in elements}

    for r in existing:
        if r.element_ref not in incoming_refs:
            await db.delete(r)

    for e in elements:
        existing_row = existing_by_ref.get(e.element_ref)
        if existing_row is not None:
            existing_row.element_source_kind = e.element_source_kind
            existing_row.element_label = e.element_label
            existing_row.point_count = e.point_count
            existing_row.coverage_percent = e.coverage_percent
            existing_row.confirmed_in_scan = e.confirmed_in_scan
        else:
            db.add(ProgressVarianceResult(
                progress_variance_test_id=test_id,
                element_source_kind=e.element_source_kind, element_ref=e.element_ref, element_label=e.element_label,
                point_count=e.point_count, coverage_percent=e.coverage_percent,
                confirmed_in_scan=e.confirmed_in_scan, status="new",
            ))

    test.last_run_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(test)
    return _to_response(test, await _results_for(db, test_id))


async def suggest_activity_progress(db: AsyncSession, test_id: uuid.UUID) -> list[ActivityProgressSuggestion]:
    """Rolls this test's latest per-element coverage_percent results up to
    whichever Activity(s) each element is separately linked to (ModelElementLink) —
    see ActivityProgressSuggestion's own docstring for why this reuses
    that existing link table instead of adding a new one."""
    test = await db.get(ProgressVarianceTest, test_id)
    if test is None:
        raise HTTPException(status_code=404, detail="Progress variance test not found")

    results = await _results_for(db, test_id)
    if not results:
        return []
    result_by_key = {(r.element_source_kind, r.element_ref): r for r in results}

    links = list((await db.execute(
        select(ModelElementLink).where(ModelElementLink.project_id == test.project_id)
    )).scalars().all())
    if not links:
        return []

    # Grouped over EVERY link for the project, not just the ones this
    # test's results happen to match — so linked_element_count reflects
    # an activity's real full scope, and matched_element_count can show
    # the reviewer how much of that scope this particular run covered.
    links_by_activity: dict[uuid.UUID, list[ModelElementLink]] = {}
    for link in links:
        links_by_activity.setdefault(link.activity_id, []).append(link)

    activities = {a.id: a for a in (await db.execute(
        select(Activity).where(Activity.id.in_(links_by_activity.keys()))
    )).scalars().all()}

    suggestions: list[ActivityProgressSuggestion] = []
    for activity_id, activity_links in links_by_activity.items():
        activity = activities.get(activity_id)
        if activity is None:
            continue
        matched = [
            result_by_key[(link.source_kind, link.element_ref)]
            for link in activity_links if (link.source_kind, link.element_ref) in result_by_key
        ]
        if not matched:
            continue
        suggested = sum(r.coverage_percent for r in matched) / len(matched)
        suggestions.append(ActivityProgressSuggestion(
            activity_id=activity_id, activity_code=activity.code, activity_name=activity.task_name,
            current_pct_complete=activity.pct_complete, scan_suggested_pct_complete=round(suggested, 1),
            linked_element_count=len(activity_links), matched_element_count=len(matched),
        ))

    suggestions.sort(key=lambda s: s.activity_code)
    return suggestions
