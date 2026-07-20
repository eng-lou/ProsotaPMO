from __future__ import annotations

import uuid
from datetime import datetime, time
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.baseline_set import BaselineSet
from app.models.cost_baseline import CostBaseline, CostBaselineItem
from app.models.cost_element import CostElement
from app.models.icd_baseline import IcdBaseline, IcdBaselineItem
from app.models.icd_item import IcdItem
from app.models.period import Period
from app.models.risk import Risk
from app.models.risk_baseline import RiskBaseline, RiskBaselineItem
from app.models.schedule_baseline import ScheduleBaseline, ScheduleBaselineActivity
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_subproject import ScheduleSubproject
from app.models.schedule_variant import ScheduleVariant
from app.schemas.dashboard import (
    BaselineComparisonResponse,
    CostComparison,
    CostComparisonItem,
    CostComparisonSummary,
    DashboardKpis,
    DashboardOverviewResponse,
    IcdComparison,
    IcdComparisonItem,
    IcdComparisonSummary,
    IcdComparisonTypeCounts,
    MilestoneTimelineItem,
    RiskComparison,
    RiskComparisonItem,
    RiskComparisonSummary,
    RiskExposureBand,
    RiskOverview,
    ScheduleBuckets,
    ScheduleComparison,
    ScheduleComparisonItem,
    ScheduleComparisonSummary,
    TopRisk,
)
from app.services.activity import _subtree_ids
from app.services.cost_element import _schedule_evm, list_cost_elements, rollup_evm_from_totals

_MONEY = Decimal("0.01")


def _resolve_bac_ac(el) -> tuple[Decimal | None, Decimal | None]:
    """BAC/AC resolution _apply_computed (app/services/cost_element.py)
    already does per element — computed_budget/computed_actuals for a
    percentage element, budget/actuals for a fixed one. Pulled out here so
    both the live KPI rollup and the baseline comparison's "current" side
    read it identically."""
    bac = el.computed_budget if el.element_type == "percentage" else el.budget
    ac = el.computed_actuals if el.element_type == "percentage" else el.actuals
    return bac, ac


async def _live_schedule_spi(db: AsyncSession, project_id: uuid.UUID, period_id: uuid.UUID) -> tuple[Decimal | None, list]:
    """PV/EV-based SPI (schedule-linked cost elements only, see
    cost_element._apply_computed's own docstring) evaluated right now —
    pulled out of _kpis so the baseline comparison's "current" side reads
    through the exact same formula rather than a second, independently-
    derived one. Also returns the live elements list, since _kpis' own
    BAC/EAC/CPI rollup needs them anyway and this avoids a second
    list_cost_elements round-trip."""
    elements = await list_cost_elements(db, project_id, period_id)
    pv_total = sum((el.pv for el in elements if el.pv is not None), Decimal(0))
    ev_total = sum((el.ev for el in elements if el.ev is not None), Decimal(0))
    has_schedule_evm = any(el.pv is not None for el in elements)
    spi = rollup_evm_from_totals(None, None, pv_total, ev_total)["spi"] if has_schedule_evm else None
    return spi, elements


async def _kpis(
    db: AsyncSession, project_id: uuid.UUID, period_id: uuid.UUID, schedule_activities: list[Activity]
) -> DashboardKpis:
    # The whole network's own latest finish — not restricted to a top-level
    # "P" WBS summary, since a schedule with more than one root branch (no
    # single enclosing "Programme" row) would otherwise never have one and
    # this KPI would always read blank. A "P" row's own finish is already a
    # rollup equal to this same max anyway, so reading every leaf directly
    # gives the identical answer and works regardless of hierarchy shape.
    planned_finish = max((a.finish for a in schedule_activities if a.finish is not None), default=None)
    planned_finish_status = "unknown"
    if planned_finish is not None:
        bl_finishes = [a.bl_finish for a in schedule_activities if a.bl_finish is not None]
        if bl_finishes:
            planned_finish_status = "delayed" if planned_finish > max(bl_finishes) else "on_time"

    issues_result = await db.execute(
        select(IcdItem).where(
            IcdItem.project_id == project_id,
            IcdItem.period_id == period_id,
            IcdItem.item_type == "issue",
            IcdItem.status != "closed",
        )
    )
    open_issues = len(issues_result.scalars().all())

    changes_result = await db.execute(
        select(IcdItem).where(
            IcdItem.project_id == project_id,
            IcdItem.period_id == period_id,
            IcdItem.item_type == "change",
            IcdItem.status != "closed",
        )
    )
    open_changes = len(changes_result.scalars().all())

    schedule_spi, elements = await _live_schedule_spi(db, project_id, period_id)

    # Portfolio BAC/EAC/CPI — every element contributes (not just schedule-linked
    # ones), unlike SPI above. BAC/AC read the same computed_budget/computed_actuals
    # (percentage elements) or budget/actuals (fixed elements) _apply_computed
    # already resolves; EV = BAC x pct_complete/100, same formula that file's own
    # docstring documents (never a second, independently-invented one). Summed
    # first, then run through the one shared rollup — never averaging per-element
    # CPIs directly (see rollup_evm_from_totals's own docstring on why that
    # misrepresents which line actually drives the portfolio's real performance).
    bac_total = ac_total = ev_cost_total = Decimal(0)
    has_cost_evm = False
    for el in elements:
        bac, ac = _resolve_bac_ac(el)
        if bac is None:
            continue
        has_cost_evm = True
        bac_total += bac
        if ac is not None:
            ac_total += ac
        if el.pct_complete is not None:
            ev_cost_total += bac * Decimal(el.pct_complete) / Decimal(100)
    cost_rollup = rollup_evm_from_totals(bac_total, ac_total, None, ev_cost_total) if has_cost_evm else {}

    return DashboardKpis(
        planned_finish=planned_finish,
        planned_finish_status=planned_finish_status,
        open_issues=open_issues,
        open_changes=open_changes,
        schedule_spi=schedule_spi,
        bac=bac_total.quantize(_MONEY) if has_cost_evm else None,
        eac=cost_rollup.get("eac"),
        cpi=cost_rollup.get("cpi"),
    )


def _schedule_buckets(activities: list[Activity], critical_attr: str) -> ScheduleBuckets:
    on_time = at_risk = delayed = 0
    for a in activities:
        if a.variance_days is not None and a.variance_days > 0:
            delayed += 1
        elif getattr(a, critical_attr) is True:
            at_risk += 1
        else:
            on_time += 1
    total = on_time + at_risk + delayed
    return ScheduleBuckets(on_time=on_time, at_risk=at_risk, delayed=delayed, total=total)


def _milestones(activities: list[Activity]) -> list[MilestoneTimelineItem]:
    items = [
        MilestoneTimelineItem(
            id=a.id, task_name=a.task_name, finish=a.finish, bl_finish=a.bl_finish,
            is_critical=a.is_critical, variance_days=a.variance_days,
        )
        for a in activities
        if a.activity_type in ("start_milestone", "finish_milestone")
    ]
    items.sort(key=lambda m: m.finish or datetime.max)
    return items


async def _top_risks(db: AsyncSession, period_id: uuid.UUID) -> list[TopRisk]:
    result = await db.execute(select(Risk).where(Risk.period_id == period_id))
    risks = list(result.scalars().all())
    risks.sort(key=lambda r: r.rating if r.rating is not None else Decimal(-1), reverse=True)
    return [
        TopRisk(
            id=r.id, code=r.code, title=r.title, status=r.status,
            rating=r.rating, emv_cost=r.emv_cost, emv_schedule_days=r.emv_schedule_days,
        )
        for r in risks[:5]
    ]


def _band_of(value: Decimal) -> int:
    """Mirrors frontend/src/components/HeatMatrix.tsx's bandOf: floor(value*5),
    clamped 0-4 — the same 5-level probability/impact band the heat matrix
    already draws for every individual risk, kept in lockstep rather than a
    second, independently-invented banding rule."""
    return min(4, max(0, int(value * 5)))


async def _risk_overview_and_exposure(db: AsyncSession, period_id: uuid.UUID) -> tuple[RiskOverview, list[RiskExposureBand]]:
    result = await db.execute(select(Risk).where(Risk.period_id == period_id))
    risks = list(result.scalars().all())

    open_risks = [r for r in risks if r.status != "closed"]
    closed_count = len(risks) - len(open_risks)

    high = medium = low = 0
    exposure = {"Low": Decimal(0), "Medium": Decimal(0), "High": Decimal(0)}
    for r in open_risks:
        if r.probability is None or r.impact is None:
            continue
        # Severity 0-8 (probBand + impactBand), same boundaries
        # HeatMatrix.tsx's cellColor already draws, collapsed from 5 colour
        # tiers to 3 counts: Low <=1, Medium 2-5, High 6-8.
        severity = _band_of(r.probability) + _band_of(r.impact)
        if severity <= 1:
            low += 1
            band = "Low"
        elif severity <= 5:
            medium += 1
            band = "Medium"
        else:
            high += 1
            band = "High"
        if r.emv_cost is not None:
            exposure[band] += r.emv_cost

    overview = RiskOverview(high=high, medium=medium, low=low, open=len(open_risks), closed=closed_count)
    exposure_bands = [RiskExposureBand(band=band, emv_cost=total.quantize(_MONEY)) for band, total in exposure.items()]
    return overview, exposure_bands


async def get_overview(
    db: AsyncSession,
    project_id: uuid.UUID,
    period_id: uuid.UUID,
    schedule_period_id: uuid.UUID,
    subproject_id: uuid.UUID | None,
    critical_only: bool,
) -> DashboardOverviewResponse:
    activities_result = await db.execute(select(Activity).where(Activity.schedule_period_id == schedule_period_id))
    all_activities = [
        a for a in activities_result.scalars().all()
        if a.activity_type != "wbs_summary" and not a.is_archived and not a.is_archive_container
    ]

    critical_attr = "is_critical"
    scoped_activities = all_activities
    if subproject_id is not None:
        subproject = await db.get(ScheduleSubproject, subproject_id)
        if subproject is None or subproject.project_id != project_id:
            raise HTTPException(status_code=404, detail="Sub-project not found in this project.")
        scope_ids = await _subtree_ids(db, schedule_period_id, subproject.root_wbs_id)
        scoped_activities = [a for a in all_activities if a.id in scope_ids]
        critical_attr = "sub_is_critical"

    bucket_activities = [a for a in scoped_activities if getattr(a, critical_attr) is True] if critical_only else scoped_activities

    kpis = await _kpis(db, project_id, period_id, all_activities)
    schedule_buckets = _schedule_buckets(bucket_activities, critical_attr)
    milestones = _milestones(scoped_activities)
    top_risks = await _top_risks(db, period_id)
    risk_overview, risk_exposure = await _risk_overview_and_exposure(db, period_id)

    return DashboardOverviewResponse(
        kpis=kpis,
        schedule_buckets=schedule_buckets,
        milestones=milestones,
        top_risks=top_risks,
        risk_overview=risk_overview,
        risk_exposure=risk_exposure,
    )


async def _baseline_schedule_spi(
    db: AsyncSession, baseline_set_id: uuid.UUID, snapshots: list[ScheduleBaselineActivity],
) -> Decimal | None:
    """The same PV/EV-based SPI formula _live_schedule_spi uses, evaluated at
    the baseline's own capture date instead of now — needs a sibling
    CostBaseline linked to this same set (for each schedule-linked element's
    baseline bac/pct_complete) plus this ScheduleBaseline's own activity
    snapshots (for baseline start/finish) — None whenever either side isn't
    there, never a guessed number."""
    cost_baseline = (await db.execute(
        select(CostBaseline).where(CostBaseline.baseline_set_id == baseline_set_id)
        .order_by(CostBaseline.created_at.desc())
    )).scalars().first()
    if cost_baseline is None:
        return None
    baseline_set = await db.get(BaselineSet, baseline_set_id)
    cost_snapshots = {s.cost_element_id: s for s in (await db.execute(
        select(CostBaselineItem).where(CostBaselineItem.baseline_id == cost_baseline.id)
    )).scalars().all()}
    if not cost_snapshots:
        return None

    schedule_linked_elements = (await db.execute(
        select(CostElement).where(
            CostElement.id.in_(cost_snapshots.keys()), CostElement.source == "schedule",
            CostElement.linked_activity_id.isnot(None),
        )
    )).scalars().all()

    activity_snap_by_id = {s.activity_id: s for s in snapshots}
    data_date = datetime.combine(baseline_set.baseline_date, time.min)
    pv_total = ev_total = Decimal(0)
    has_schedule_evm = False
    for el in schedule_linked_elements:
        activity_snap = activity_snap_by_id.get(el.linked_activity_id)
        cost_snap = cost_snapshots.get(el.id)
        if activity_snap is None or cost_snap is None:
            continue
        pv, ev, _sv, _spi = _schedule_evm(cost_snap.bac, cost_snap.pct_complete, activity_snap.start, activity_snap.finish, data_date)
        if pv is None:
            continue
        has_schedule_evm = True
        pv_total += pv
        if ev is not None:
            ev_total += ev

    return rollup_evm_from_totals(None, None, pv_total, ev_total)["spi"] if has_schedule_evm else None


async def _schedule_comparison(db: AsyncSession, baseline_set_id: uuid.UUID) -> ScheduleComparison | None:
    baseline = (await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.baseline_set_id == baseline_set_id)
        .order_by(ScheduleBaseline.created_at.desc())
    )).scalars().first()
    if baseline is None:
        return None

    snapshots = (await db.execute(
        select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id == baseline.id)
    )).scalars().all()
    snapshot_activity_ids = {s.activity_id for s in snapshots}
    activities = {a.id: a for a in (await db.execute(
        select(Activity).where(Activity.id.in_(snapshot_activity_ids))
    )).scalars().all()}

    items = []
    slip_days: list[int] = []
    for snap in snapshots:
        activity = activities.get(snap.activity_id)
        current_finish = activity.finish if activity else None
        variance_days = (
            (current_finish - snap.finish).days if current_finish is not None and snap.finish is not None else None
        )
        if variance_days is not None:
            slip_days.append(variance_days)
        items.append(ScheduleComparisonItem(
            activity_id=snap.activity_id, code=snap.code, task_name=activity.task_name if activity else snap.code,
            baseline_finish=snap.finish, current_finish=current_finish, variance_days=variance_days,
        ))

    # Activities added since the baseline was captured (no snapshot at all)
    # — surfaced with no baseline_finish rather than silently omitted, per
    # Maro: "if an item was added within period then it should [be] shown."
    # variance_days stays None for these (nothing to compare against), so
    # they never affect slipped_count/avg_slip_days below.
    added_activities = (await db.execute(
        select(Activity).where(
            Activity.schedule_period_id == baseline.schedule_period_id,
            Activity.activity_type != "wbs_summary", Activity.is_archived.is_(False), Activity.is_archive_container.is_(False),
            Activity.id.notin_(snapshot_activity_ids),
        )
    )).scalars().all()
    for activity in added_activities:
        items.append(ScheduleComparisonItem(
            activity_id=activity.id, code=activity.code, task_name=activity.task_name,
            baseline_finish=None, current_finish=activity.finish, variance_days=None,
        ))

    slipped_count = sum(1 for d in slip_days if d > 0)
    avg_slip = (Decimal(sum(slip_days)) / Decimal(len(slip_days))).quantize(Decimal("0.1")) if slip_days else None

    baseline_spi = await _baseline_schedule_spi(db, baseline_set_id, snapshots)
    period_row = await db.get(SchedulePeriod, baseline.schedule_period_id)
    variant = await db.get(ScheduleVariant, period_row.schedule_variant_id) if period_row else None
    current_spi = None
    if variant is not None:
        # "Current" SPI needs Risk/Cost/ICD's own shared Period, not this
        # SchedulePeriod — resolved via the sibling CostBaseline in this same
        # set (same period every module baseline in a capture-all set shares).
        cost_baseline = (await db.execute(
            select(CostBaseline).where(CostBaseline.baseline_set_id == baseline_set_id)
            .order_by(CostBaseline.created_at.desc())
        )).scalars().first()
        if cost_baseline is not None:
            current_spi, _elements = await _live_schedule_spi(db, variant.project_id, cost_baseline.period_id)

    return ScheduleComparison(
        baseline_name=baseline.name,
        summary=ScheduleComparisonSummary(
            total=len(items), slipped_count=slipped_count, avg_slip_days=avg_slip,
            baseline_spi=baseline_spi, current_spi=current_spi,
        ),
        items=items,
    )


async def _risk_comparison(db: AsyncSession, baseline_set_id: uuid.UUID) -> RiskComparison | None:
    baseline = (await db.execute(
        select(RiskBaseline).where(RiskBaseline.baseline_set_id == baseline_set_id)
        .order_by(RiskBaseline.created_at.desc())
    )).scalars().first()
    if baseline is None:
        return None

    snapshots = (await db.execute(
        select(RiskBaselineItem).where(RiskBaselineItem.baseline_id == baseline.id)
    )).scalars().all()
    snapshot_risk_ids = {s.risk_id for s in snapshots}
    risks = {r.id: r for r in (await db.execute(
        select(Risk).where(Risk.id.in_(snapshot_risk_ids))
    )).scalars().all()}

    items = []
    increased = decreased = unchanged = 0
    baseline_emv_total = current_emv_total = Decimal(0)
    for snap in snapshots:
        risk = risks.get(snap.risk_id)
        current_rating = risk.rating if risk else None
        current_emv_cost = risk.emv_cost if risk else None
        baseline_emv_total += snap.emv_cost or Decimal(0)
        current_emv_total += current_emv_cost or Decimal(0)
        if snap.rating is not None and current_rating is not None:
            if current_rating > snap.rating:
                increased += 1
            elif current_rating < snap.rating:
                decreased += 1
            else:
                unchanged += 1
        else:
            unchanged += 1
        items.append(RiskComparisonItem(
            risk_id=snap.risk_id, code=snap.code, title=risk.title if risk else snap.title,
            baseline_rating=snap.rating, current_rating=current_rating,
            baseline_emv_cost=snap.emv_cost, current_emv_cost=current_emv_cost,
        ))

    # Risks raised since the baseline was captured — no prior state to
    # compare direction against, so they don't count toward increased/
    # decreased/unchanged, but their current EMV still belongs in the
    # portfolio's current total, and they're shown rather than omitted.
    added_risks = (await db.execute(
        select(Risk).where(Risk.period_id == baseline.period_id, Risk.id.notin_(snapshot_risk_ids))
    )).scalars().all()
    for risk in added_risks:
        current_emv_total += risk.emv_cost or Decimal(0)
        items.append(RiskComparisonItem(
            risk_id=risk.id, code=risk.code, title=risk.title,
            baseline_rating=None, current_rating=risk.rating,
            baseline_emv_cost=None, current_emv_cost=risk.emv_cost,
        ))

    return RiskComparison(
        baseline_name=baseline.name,
        summary=RiskComparisonSummary(
            increased_count=increased, decreased_count=decreased, unchanged_count=unchanged,
            baseline_emv_cost_total=baseline_emv_total.quantize(_MONEY), current_emv_cost_total=current_emv_total.quantize(_MONEY),
        ),
        items=items,
    )


async def _cost_comparison(db: AsyncSession, baseline_set_id: uuid.UUID) -> CostComparison | None:
    baseline = (await db.execute(
        select(CostBaseline).where(CostBaseline.baseline_set_id == baseline_set_id)
        .order_by(CostBaseline.created_at.desc())
    )).scalars().first()
    if baseline is None:
        return None

    snapshots = (await db.execute(
        select(CostBaselineItem).where(CostBaselineItem.baseline_id == baseline.id)
    )).scalars().all()
    snapshot_element_ids = {s.cost_element_id for s in snapshots}
    period = await db.get(Period, baseline.period_id)
    # Reuses the *live* elements (already computes computed_budget/computed_actuals
    # for percentage elements) so "current" always reads through the one shared
    # resolution path — never a second, independently-derived figure.
    elements = {el.id: el for el in await list_cost_elements(db, period.project_id, baseline.period_id)}

    items = []
    baseline_bac_total = baseline_ac_total = baseline_ev_total = Decimal(0)
    # "Current" totals sum over *every* live element, not just ones that
    # existed at baseline time — an element added since capture still
    # belongs in today's real BAC/CPI/EAC, otherwise the portfolio total
    # itself would silently undercount (Maro: added items "should [be]
    # shown," which has to be true of the aggregate too, not just the table).
    current_bac_total = current_ac_total = current_ev_total = Decimal(0)
    for el in elements.values():
        bac, ac = _resolve_bac_ac(el)
        if bac is None:
            continue
        current_bac_total += bac
        current_ac_total += ac or Decimal(0)
        if el.pct_complete is not None:
            current_ev_total += bac * Decimal(el.pct_complete) / Decimal(100)

    for snap in snapshots:
        baseline_bac_total += snap.bac
        baseline_ac_total += snap.ac or Decimal(0)
        baseline_ev = snap.bac * Decimal(snap.pct_complete) / Decimal(100) if snap.pct_complete is not None else None
        if baseline_ev is not None:
            baseline_ev_total += baseline_ev
        baseline_cpi = (baseline_ev / snap.ac).quantize(Decimal("0.0001")) if baseline_ev is not None and snap.ac else None

        el = elements.get(snap.cost_element_id)
        current_budget, current_ac = _resolve_bac_ac(el) if el else (None, None)
        current_cpi = None
        if el is not None and current_budget is not None and el.pct_complete is not None and current_ac:
            current_ev = current_budget * Decimal(el.pct_complete) / Decimal(100)
            current_cpi = (current_ev / current_ac).quantize(Decimal("0.0001"))

        items.append(CostComparisonItem(
            cost_element_id=snap.cost_element_id, code=snap.code, description=el.description if el else snap.description,
            baseline_budget=snap.bac, current_budget=current_budget,
            baseline_cpi=baseline_cpi, current_cpi=current_cpi,
        ))

    # Cost elements added since the baseline was captured — no baseline
    # figure at all, shown rather than omitted (their current BAC/EV already
    # rolled into current_bac_total/current_ev_total above).
    for el in elements.values():
        if el.id in snapshot_element_ids:
            continue
        current_budget, current_ac = _resolve_bac_ac(el)
        if current_budget is None:
            continue
        current_cpi = None
        if el.pct_complete is not None and current_ac:
            current_ev = current_budget * Decimal(el.pct_complete) / Decimal(100)
            current_cpi = (current_ev / current_ac).quantize(Decimal("0.0001"))
        items.append(CostComparisonItem(
            cost_element_id=el.id, code=el.code, description=el.description,
            baseline_budget=None, current_budget=current_budget,
            baseline_cpi=None, current_cpi=current_cpi,
        ))

    baseline_rollup = rollup_evm_from_totals(baseline_bac_total, baseline_ac_total, None, baseline_ev_total)
    current_rollup = rollup_evm_from_totals(current_bac_total, current_ac_total, None, current_ev_total)
    return CostComparison(
        baseline_name=baseline.name,
        summary=CostComparisonSummary(
            baseline_bac=baseline_bac_total.quantize(_MONEY), current_bac=current_bac_total.quantize(_MONEY),
            baseline_cpi=baseline_rollup["cpi"], current_cpi=current_rollup["cpi"],
            baseline_eac=baseline_rollup["eac"], current_eac=current_rollup["eac"],
        ),
        items=items,
    )


async def _icd_comparison(db: AsyncSession, baseline_set_id: uuid.UUID) -> IcdComparison | None:
    baseline = (await db.execute(
        select(IcdBaseline).where(IcdBaseline.baseline_set_id == baseline_set_id)
        .order_by(IcdBaseline.created_at.desc())
    )).scalars().first()
    if baseline is None:
        return None

    snapshots = (await db.execute(
        select(IcdBaselineItem).where(IcdBaselineItem.baseline_id == baseline.id)
    )).scalars().all()
    snapshot_item_ids = {s.icd_item_id for s in snapshots}
    live_all = (await db.execute(select(IcdItem).where(IcdItem.period_id == baseline.period_id))).scalars().all()
    live_items = {i.id: i for i in live_all}

    items = []
    # "Current" open counts are computed over *every* live item, not just
    # ones that existed at baseline time — same reasoning as Cost's totals
    # above: an item raised since capture still belongs in today's real
    # open count. "Baseline" open counts stay scoped to what was actually
    # captured, since that's genuinely what the baseline snapshot recorded.
    open_counts = {t: {"baseline": 0, "current": 0} for t in ("issue", "change", "decision")}
    for live in live_all:
        if live.status != "closed":
            open_counts[live.item_type]["current"] += 1

    for snap in snapshots:
        live = live_items.get(snap.icd_item_id)
        current_status = live.status if live else None
        if snap.status != "closed":
            open_counts[snap.item_type]["baseline"] += 1
        items.append(IcdComparisonItem(
            icd_item_id=snap.icd_item_id, code=snap.code, item_type=snap.item_type,
            title=live.title if live else snap.title, baseline_status=snap.status, current_status=current_status,
        ))

    # Items raised since the baseline was captured — shown with no
    # baseline_status rather than omitted; already counted in "current"
    # open above.
    for live in live_all:
        if live.id in snapshot_item_ids:
            continue
        items.append(IcdComparisonItem(
            icd_item_id=live.id, code=live.code, item_type=live.item_type,
            title=live.title, baseline_status=None, current_status=live.status,
        ))

    return IcdComparison(
        baseline_name=baseline.name,
        summary=IcdComparisonSummary(**{
            t: IcdComparisonTypeCounts(baseline_open=c["baseline"], current_open=c["current"])
            for t, c in open_counts.items()
        }),
        items=items,
    )


async def get_baseline_comparison(db: AsyncSession, baseline_set_id: uuid.UUID) -> BaselineComparisonResponse:
    baseline_set = await db.get(BaselineSet, baseline_set_id)
    if baseline_set is None:
        raise HTTPException(status_code=404, detail="Baseline set not found")

    return BaselineComparisonResponse(
        baseline_set_name=baseline_set.name,
        baseline_set_date=baseline_set.baseline_date,
        schedule=await _schedule_comparison(db, baseline_set_id),
        risk=await _risk_comparison(db, baseline_set_id),
        cost=await _cost_comparison(db, baseline_set_id),
        icd=await _icd_comparison(db, baseline_set_id),
    )
