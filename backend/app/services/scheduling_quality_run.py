from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduling_quality_run import SchedulingQualityRun
from app.schemas.scheduling_quality import QualityReport
from app.schemas.scheduling_quality_run import SchedulingQualityRunCreate, SchedulingQualityRunSummary
from app.services import scheduling_quality as quality_svc


async def create_run(db: AsyncSession, data: SchedulingQualityRunCreate) -> SchedulingQualityRun:
    report = await quality_svc.compute_quality(db, data.schedule_period_id, data.scope_subproject_id)
    # JSONB storage needs JSON-safe values (compute_quality returns a raw dict
    # with a UUID schedule_period_id) — round-tripping through the schema
    # converts it, same as the router's response_model normally would.
    report_json = QualityReport(**report).model_dump(mode="json")
    row = SchedulingQualityRun(
        schedule_period_id=data.schedule_period_id, name=data.name, report=report_json,
        scope_subproject_id=data.scope_subproject_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _to_summary(row: SchedulingQualityRun) -> SchedulingQualityRunSummary:
    checks = row.report.get("checks", [])
    return SchedulingQualityRunSummary(
        id=row.id, schedule_period_id=row.schedule_period_id, name=row.name, created_at=row.created_at,
        logic_score=row.report.get("logic_score"),
        failing_count=sum(1 for c in checks if c.get("status") == "fail"),
        warning_count=sum(1 for c in checks if c.get("status") == "warn"),
        scope_subproject_id=row.scope_subproject_id,
        # Denormalized from the frozen report, not re-looked-up — a run saved
        # against a sub-project later renamed or untagged should still show
        # the name it actually had at analysis time (2026-07-06, per Maro).
        scope_name=row.report.get("scope_name"),
    )


async def list_runs(db: AsyncSession, schedule_period_id: uuid.UUID) -> list[SchedulingQualityRunSummary]:
    rows = (await db.execute(
        select(SchedulingQualityRun)
        .where(SchedulingQualityRun.schedule_period_id == schedule_period_id)
        .order_by(SchedulingQualityRun.created_at.desc())
    )).scalars().all()
    return [_to_summary(r) for r in rows]


async def get_run(db: AsyncSession, run_id: uuid.UUID) -> SchedulingQualityRun:
    row = await db.get(SchedulingQualityRun, run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Saved analysis not found")
    return row


async def delete_run(db: AsyncSession, run_id: uuid.UUID) -> None:
    row = await db.get(SchedulingQualityRun, run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Saved analysis not found")
    await db.delete(row)
    await db.commit()
