from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.baseline_set import BaselineSet
from app.models.cost_baseline import CostBaseline
from app.models.icd_baseline import IcdBaseline
from app.models.period import Period
from app.models.risk_baseline import RiskBaseline
from app.models.schedule_baseline import ScheduleBaseline
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_variant import ScheduleVariant
from app.schemas.baseline_set import BaselineLinkUpdate, BaselineSetCreate, CaptureAllCreate
from app.schemas.cost_baseline import CostBaselineCreate
from app.schemas.icd_baseline import IcdBaselineCreate
from app.schemas.risk_baseline import RiskBaselineCreate
from app.schemas.schedule_baseline import ScheduleBaselineCreate
from app.services import cost_baseline as cost_baseline_svc
from app.services import icd_baseline as icd_baseline_svc
from app.services import risk_baseline as risk_baseline_svc
from app.services import schedule_baseline as schedule_baseline_svc

_MODULE_MODELS = {
    "risk": RiskBaseline,
    "cost": CostBaseline,
    "icd": IcdBaseline,
    "schedule": ScheduleBaseline,
}


async def list_baseline_sets(db: AsyncSession, project_id: uuid.UUID) -> list[BaselineSet]:
    result = await db.execute(
        select(BaselineSet).where(BaselineSet.project_id == project_id)
        .order_by(BaselineSet.baseline_date.desc(), BaselineSet.created_at.desc())
    )
    return list(result.scalars().all())


async def create_baseline_set(db: AsyncSession, data: BaselineSetCreate) -> BaselineSet:
    """A bare, empty BaselineSet with nothing linked into it yet (2026-09-03,
    per Maro: "i set a schedule baseline and assigned it but its not shown
    here" — a real, previously-acknowledged gap: BaselineManagerWidget.tsx's
    own comment already said "Baseline Sets are managed from the Dashboard's
    Baseline Comparison, not here," but no UI there ever actually called
    link_baseline below — this is the missing other half, alongside
    capture_all's own one-click "snapshot everything now" path, for "I
    already baselined Schedule/Cost/... separately, just bundle the ones I
    already have.\""""
    baseline_set = BaselineSet(project_id=data.project_id, name=data.name, baseline_date=data.baseline_date)
    db.add(baseline_set)
    await db.commit()
    await db.refresh(baseline_set)
    return baseline_set


async def capture_all(db: AsyncSession, data: CaptureAllCreate) -> BaselineSet:
    """One-click "capture everything now" (2026-07-20, per Maro — Controls
    Dashboard Phase 1b): creates a new BaselineSet, then one baseline per
    module (Risk/Cost/ICD off the project's live Period, Schedule off the
    given live SchedulePeriod), all tagged to the new set. Each module's own
    create_baseline does the real snapshotting — this just orchestrates and
    links, never a second, parallel snapshot mechanism."""
    baseline_set = BaselineSet(project_id=data.project_id, name=data.name, baseline_date=data.baseline_date)
    db.add(baseline_set)
    await db.flush()

    risk_baseline = await risk_baseline_svc.create_baseline(
        db, RiskBaselineCreate(period_id=data.period_id, name=data.name, baseline_date=data.baseline_date)
    )
    risk_baseline.baseline_set_id = baseline_set.id

    cost_baseline = await cost_baseline_svc.create_baseline(
        db, CostBaselineCreate(period_id=data.period_id, name=data.name, baseline_date=data.baseline_date)
    )
    cost_baseline.baseline_set_id = baseline_set.id

    icd_baseline = await icd_baseline_svc.create_baseline(
        db, IcdBaselineCreate(period_id=data.period_id, name=data.name, baseline_date=data.baseline_date)
    )
    icd_baseline.baseline_set_id = baseline_set.id

    schedule_baseline = await schedule_baseline_svc.create_baseline(
        db, ScheduleBaselineCreate(schedule_period_id=data.schedule_period_id, name=data.name, baseline_date=data.baseline_date)
    )
    schedule_baseline.baseline_set_id = baseline_set.id

    await db.commit()
    await db.refresh(baseline_set)
    return baseline_set


async def _project_id_for_baseline(db: AsyncSession, module: str, baseline) -> uuid.UUID:
    if module == "schedule":
        schedule_period = await db.get(SchedulePeriod, baseline.schedule_period_id)
        variant = await db.get(ScheduleVariant, schedule_period.schedule_variant_id)
        return variant.project_id
    period = await db.get(Period, baseline.period_id)
    return period.project_id


async def link_baseline(db: AsyncSession, data: BaselineLinkUpdate) -> None:
    """Attaches (or detaches, if baseline_set_id is None) one already-existing
    standalone module baseline into a BaselineSet — the manual half of
    linking, alongside capture_all's one-click automatic half (both
    confirmed with Maro as needed: "I already baselined Cost last week, just
    link it in now" vs. "capture everything together")."""
    model = _MODULE_MODELS[data.module]
    baseline = await db.get(model, data.baseline_id)
    if baseline is None:
        raise HTTPException(status_code=404, detail="Baseline not found")

    if data.baseline_set_id is not None:
        baseline_set = await db.get(BaselineSet, data.baseline_set_id)
        if baseline_set is None:
            raise HTTPException(status_code=404, detail="Baseline set not found")
        baseline_project_id = await _project_id_for_baseline(db, data.module, baseline)
        if baseline_set.project_id != baseline_project_id:
            raise HTTPException(status_code=422, detail="Baseline set belongs to a different project")

    baseline.baseline_set_id = data.baseline_set_id
    await db.commit()
