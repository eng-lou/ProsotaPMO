from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cost_element import CostElement
from app.models.period import Period
from app.models.project import Project
from app.schemas.cost_element import CostElementCreate, CostElementResponse, CostElementUpdate
from app.services.reference_codes import next_code

_MONEY = Decimal("0.01")
_RATIO = Decimal("0.0001")


async def _require_live_period(db: AsyncSession, period_id: uuid.UUID) -> None:
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    if period.freeze_status != "live":
        raise HTTPException(
            status_code=422,
            detail=f"Period '{period.period_label}' is {period.freeze_status}. Writes to frozen periods are not allowed.",
        )


def _element_forecast(
    budget: Decimal | None, actuals: Decimal | None, pct_complete: int | None
) -> Decimal | None:
    """forecast IS the computed EAC (Estimate at Completion) — the same concept as
    "what do we now expect this line to finally cost", not a separate manual figure.
    Falls back to budget before any progress has been assessed."""
    if budget is None:
        return None
    budget = Decimal(str(budget))
    if pct_complete is not None and actuals is not None:
        actuals = Decimal(str(actuals))
        if actuals != 0:
            ev = budget * Decimal(pct_complete) / Decimal(100)
            cpi = ev / actuals
            if cpi != 0:
                return (budget / cpi).quantize(_MONEY)
    return budget.quantize(_MONEY)


async def _fixed_subtotals(
    db: AsyncSession, project_id: uuid.UUID, period_id: uuid.UUID
) -> tuple[Decimal, Decimal, Decimal]:
    """Return (sum_budget, sum_forecast, sum_actuals) for all fixed elements in this
    project/period. sum_forecast is the sum of each element's derived forecast
    (EAC, or budget before any progress is assessed) — computed in Python since
    forecast is no longer a stored column."""
    q = select(CostElement.budget, CostElement.actuals, CostElement.pct_complete).where(
        CostElement.project_id == project_id,
        CostElement.period_id == period_id,
        CostElement.element_type == "fixed",
    )
    rows = (await db.execute(q)).all()
    sum_budget = sum((Decimal(str(r.budget)) for r in rows if r.budget is not None), Decimal(0))
    sum_actuals = sum((Decimal(str(r.actuals)) for r in rows if r.actuals is not None), Decimal(0))
    sum_forecast = sum(
        (_element_forecast(r.budget, r.actuals, r.pct_complete) or Decimal(0) for r in rows), Decimal(0)
    )
    return sum_budget, sum_forecast, sum_actuals


async def _project_gfa(db: AsyncSession, project_id: uuid.UUID) -> Decimal | None:
    project = await db.get(Project, project_id)
    if project is None or project.gfa_m2 is None or project.gfa_m2 == 0:
        return None
    return Decimal(str(project.gfa_m2))


async def _linked_activity_baselines(
    db: AsyncSession, elements: list[CostElement]
) -> dict[uuid.UUID, tuple[datetime | None, datetime | None]]:
    """bl_start/bl_finish for every schedule-sourced element's linked activity, in
    one batched query — the input a real Planned Value curve needs (Resources
    module, Phase 3). Elements with no linked activity, or that have been manually
    unlinked, are simply absent from the result."""
    activity_ids = {
        el.linked_activity_id for el in elements
        if el.source == "schedule" and el.linked_activity_id is not None
    }
    if not activity_ids:
        return {}
    result = await db.execute(
        select(Activity.id, Activity.bl_start, Activity.bl_finish).where(Activity.id.in_(activity_ids))
    )
    return {row.id: (row.bl_start, row.bl_finish) for row in result.all()}


def _schedule_evm(
    budget: Decimal | None,
    pct_complete: int | None,
    bl_start: datetime | None,
    bl_finish: datetime | None,
    today: date,
) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None]:
    """Planned Value (Rita Mulcahy Ch.9: "as of today, the estimated value of work
    planned to be done") via linear proration across the activity's baseline
    start/finish — the standard simple PV-distribution technique, at day
    granularity (consistent with variance_days staying day-based post-Phase-10;
    a documented interpretation, not a rigorously-derived one, same as the DCMA
    thresholds elsewhere in this codebase). EV/SV/SPI follow directly from PV
    once it exists. Returns (pv, ev, sv, spi) — any of which can be None if the
    inputs aren't there yet (no budget, no baseline captured, no progress
    assessed)."""
    if budget is None or bl_start is None or bl_finish is None:
        return None, None, None, None
    budget = Decimal(str(budget))
    start_d, finish_d = bl_start.date(), bl_finish.date()

    if finish_d <= start_d:
        fraction = Decimal(1) if today >= finish_d else Decimal(0)
    elif today <= start_d:
        fraction = Decimal(0)
    elif today >= finish_d:
        fraction = Decimal(1)
    else:
        fraction = Decimal((today - start_d).days) / Decimal((finish_d - start_d).days)

    pv = (budget * fraction).quantize(_MONEY)
    ev = (budget * Decimal(pct_complete) / Decimal(100)).quantize(_MONEY) if pct_complete is not None else None
    sv = (ev - pv).quantize(_MONEY) if ev is not None else None
    spi = (ev / pv).quantize(_RATIO) if ev is not None and pv != 0 else None
    return pv, ev, sv, spi


def _apply_computed(
    element: CostElement,
    sub_budget: Decimal,
    sub_forecast: Decimal,
    sub_actuals: Decimal,
    gfa_m2: Decimal | None,
    activity_baseline: tuple[datetime | None, datetime | None] | None = None,
) -> CostElementResponse:
    data = CostElementResponse.model_validate(element)

    if activity_baseline is not None:
        data.pv, data.ev, data.sv, data.spi = _schedule_evm(
            element.budget, element.pct_complete, activity_baseline[0], activity_baseline[1], date.today()
        )

    if element.element_type == "percentage" and element.rate is not None:
        rate = Decimal(str(element.rate))
        data.computed_budget = (rate * sub_budget).quantize(_MONEY)
        data.computed_forecast = (rate * sub_forecast).quantize(_MONEY)
        data.computed_actuals = (rate * sub_actuals).quantize(_MONEY)
    else:
        data.forecast = _element_forecast(element.budget, element.actuals, element.pct_complete)

    # BAC/AC resolve to the computed value for percentage elements, the stored value for
    # fixed elements — everything below is derived from these two, plus pct_complete and
    # rev_a_baseline, never accepted as API input.
    #
    # Cost-side EVM (CV/CPI/EAC/ETC/VAC/TCPI) is computed here unconditionally. Schedule-
    # side EVM (PV/EV/SV/SPI) needed a genuine time-phased planned value — "how much
    # should have been done by this date on the schedule" — which only exists for
    # "schedule"-sourced elements linked to an activity with captured baseline dates
    # (Resources module, Phase 3 — see _schedule_evm/activity_baseline above). Every other
    # element still leaves PV/EV/SV/SPI null rather than showing a fake number (e.g. SPI
    # would always equal pct_complete/100 exactly without a real baseline to compare to).
    bac = data.computed_budget if element.element_type == "percentage" else element.budget
    ac = data.computed_actuals if element.element_type == "percentage" else element.actuals
    bac = Decimal(str(bac)) if bac is not None else None
    ac = Decimal(str(ac)) if ac is not None else None

    if bac is not None and element.rev_a_baseline is not None:
        data.variance = (bac - Decimal(str(element.rev_a_baseline))).quantize(_MONEY)

    if bac is not None and gfa_m2 is not None:
        data.cost_per_m2 = (bac / gfa_m2).quantize(_MONEY)

    ev: Decimal | None = None
    if bac is not None and element.pct_complete is not None:
        ev = (bac * Decimal(element.pct_complete) / Decimal(100)).quantize(_MONEY)

    if ev is not None and ac is not None:
        data.cv = (ev - ac).quantize(_MONEY)
    if ev is not None and ac is not None and ac != 0:
        data.cpi = (ev / ac).quantize(_RATIO)
    if bac is not None and data.cpi is not None and data.cpi != 0:
        data.eac = (bac / data.cpi).quantize(_MONEY)
    if data.eac is not None and ac is not None:
        data.etc = (data.eac - ac).quantize(_MONEY)
    if bac is not None and data.eac is not None:
        data.vac = (bac - data.eac).quantize(_MONEY)
    if bac is not None and ev is not None and ac is not None and (bac - ac) != 0:
        data.tcpi = ((bac - ev) / (bac - ac)).quantize(_RATIO)

    return data


async def list_cost_elements(
    db: AsyncSession,
    project_id: uuid.UUID,
    period_id: uuid.UUID | None = None,
) -> list[CostElementResponse]:
    q = select(CostElement).where(CostElement.project_id == project_id)
    if period_id is not None:
        q = q.where(CostElement.period_id == period_id)
    elements = list((await db.execute(q)).scalars().all())

    gfa_m2 = await _project_gfa(db, project_id)
    baselines = await _linked_activity_baselines(db, elements)

    # Group percentage calculations by period to avoid N+1 subtotal queries
    period_subtotals: dict[uuid.UUID, tuple[Decimal, Decimal, Decimal]] = {}
    for el in elements:
        if el.element_type == "percentage" and el.period_id not in period_subtotals:
            period_subtotals[el.period_id] = await _fixed_subtotals(db, project_id, el.period_id)

    results = []
    for el in elements:
        if el.element_type == "percentage":
            subs = period_subtotals[el.period_id]
        else:
            subs = (Decimal(0), Decimal(0), Decimal(0))
        results.append(_apply_computed(el, *subs, gfa_m2, baselines.get(el.linked_activity_id)))
    return results


async def get_cost_element(db: AsyncSession, element_id: uuid.UUID) -> CostElementResponse:
    el = await db.get(CostElement, element_id)
    if el is None:
        raise HTTPException(status_code=404, detail="Cost element not found")
    gfa_m2 = await _project_gfa(db, el.project_id)
    baselines = await _linked_activity_baselines(db, [el])
    if el.element_type == "percentage":
        subs = await _fixed_subtotals(db, el.project_id, el.period_id)
    else:
        subs = (Decimal(0), Decimal(0), Decimal(0))
    return _apply_computed(el, *subs, gfa_m2, baselines.get(el.linked_activity_id))


async def create_cost_element(db: AsyncSession, data: CostElementCreate) -> CostElementResponse:
    await _require_live_period(db, data.period_id)
    code = await next_code(db, CostElement, "CST", data.project_id)
    el = CostElement(**data.model_dump(), code=code)
    # rev_a_baseline is not a separate input — the budget entered now IS the baseline,
    # since there's no prior revision to compare against yet. Frozen from here on;
    # routine budget updates never touch it (a genuine re-baseline would be a distinct,
    # deliberate action, not implemented yet).
    if el.element_type == "fixed":
        el.rev_a_baseline = el.budget
    db.add(el)
    await db.commit()
    await db.refresh(el)
    return await get_cost_element(db, el.id)


async def update_cost_element(
    db: AsyncSession, element_id: uuid.UUID, data: CostElementUpdate
) -> CostElementResponse:
    el = await db.get(CostElement, element_id)
    if el is None:
        raise HTTPException(status_code=404, detail="Cost element not found")
    await _require_live_period(db, el.period_id)
    updates = data.model_dump(exclude_unset=True)
    # Resources module: a schedule-managed element's budget is normally kept in
    # sync automatically from resource assignments (app/services/cost_sync.py,
    # which writes directly to the ORM and never calls this function). Reaching
    # this function with a budget edit means a user is editing it directly via
    # Cost Plan's own UI — that permanently unlinks it, per Maro's confirmed spec
    # (docs/RESOURCES_MODULE_PLAN.md). Metadata-only edits (status, cost owner,
    # commentary, sign-off, etc.) don't unlink — only budget does.
    if el.source == "schedule" and "budget" in updates:
        el.source = "manual"
    for field, value in updates.items():
        setattr(el, field, value)
    await db.commit()
    await db.refresh(el)
    return await get_cost_element(db, el.id)


async def delete_cost_element(db: AsyncSession, element_id: uuid.UUID) -> None:
    el = await db.get(CostElement, element_id)
    if el is None:
        raise HTTPException(status_code=404, detail="Cost element not found")
    await _require_live_period(db, el.period_id)
    await db.delete(el)
    await db.commit()
