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
from app.services.scheduling_cpm import data_date_for_period, elapsed_duration_fraction

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


async def _linked_activity_dates(
    db: AsyncSession, elements: list[CostElement]
) -> dict[uuid.UUID, tuple[datetime | None, datetime | None]]:
    """Live (current, CPM-computed) start/finish for every schedule-sourced
    element's linked activity, in one batched query — the input Planned Value
    needs. Deliberately the LIVE start/finish, not bl_start/bl_finish: per
    Maro's confirmed correction (P6 domain expertise), PV tracks the data date
    against the activity's own current schedule position — "how far along its
    duration should it be by now" — available the moment the activity is
    scheduled, not gated on a "Set Baseline" capture. The baseline continues to
    drive schedule variance (Fin. Var (d) — current Finish vs bl_finish), a
    separate concern from EVM's PV. Elements with no linked activity, or that
    have been manually unlinked, are simply absent from the result."""
    activity_ids = {
        el.linked_activity_id for el in elements
        if el.source == "schedule" and el.linked_activity_id is not None
    }
    if not activity_ids:
        return {}
    result = await db.execute(
        select(Activity.id, Activity.start, Activity.finish).where(Activity.id.in_(activity_ids))
    )
    return {row.id: (row.start, row.finish) for row in result.all()}


async def _period_data_dates(db: AsyncSession, period_ids: set[uuid.UUID]) -> dict[uuid.UUID, date]:
    """Each period's data date, batched — see
    app/services/scheduling_cpm.py:data_date_for_period, the same anchor the CPM
    engine schedules from."""
    if not period_ids:
        return {}
    result = await db.execute(select(Period).where(Period.id.in_(period_ids)))
    return {p.id: data_date_for_period(p) for p in result.scalars().all()}


def _schedule_evm(
    budget: Decimal | None,
    pct_complete: int | None,
    start: datetime | None,
    finish: datetime | None,
    data_date: date,
) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None]:
    """Planned Value (Rita Mulcahy Ch.9: "as of today, the estimated value of work
    planned to be done") via linear proration across the activity's own current
    start/finish against the data date — "Activity % Complete" (duration
    elapsed), distinct from the manually-assessed Physical % Complete that
    drives EV. Day-granularity proration (consistent with variance_days staying
    day-based post-Phase-10; a documented interpretation, not a rigorously-
    derived one, same as the DCMA thresholds elsewhere in this codebase).
    EV/SV/SPI follow directly from PV once it exists. Returns (pv, ev, sv, spi)
    — any of which can be None if the inputs aren't there yet (no budget, the
    activity isn't scheduled yet, no progress assessed)."""
    fraction = elapsed_duration_fraction(start, finish, data_date)
    if budget is None or fraction is None:
        return None, None, None, None
    budget = Decimal(str(budget))

    pv = (budget * fraction).quantize(_MONEY)
    ev = (budget * Decimal(pct_complete) / Decimal(100)).quantize(_MONEY) if pct_complete is not None else None
    sv = (ev - pv).quantize(_MONEY) if ev is not None else None
    spi = (ev / pv).quantize(_RATIO) if ev is not None and pv != 0 else None
    return pv, ev, sv, spi


def _cost_side_evm(
    bac: Decimal | None, ac: Decimal | None, ev: Decimal | None
) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None]:
    """CV/CPI/EAC/ETC from BAC/AC/EV — extracted so this stays the one place these
    formulas live, shared by _apply_computed (Cost Plan) and
    compute_schedule_linked_evm (Scheduling's EVM columns) rather than drifting
    into two copies."""
    cv = (ev - ac).quantize(_MONEY) if ev is not None and ac is not None else None
    cpi = (ev / ac).quantize(_RATIO) if ev is not None and ac is not None and ac != 0 else None
    eac = (bac / cpi).quantize(_MONEY) if bac is not None and cpi is not None and cpi != 0 else None
    etc = (eac - ac).quantize(_MONEY) if eac is not None and ac is not None else None
    return cv, cpi, eac, etc


def compute_schedule_linked_evm(
    element: CostElement, start: datetime | None, finish: datetime | None, data_date: date
) -> dict[str, Decimal | None]:
    """AC/PV/EV/CV/SV/CPI/SPI/BAC/EAC/ETC for a single schedule-linked cost
    element — used by app/services/activity.py to surface these as Scheduling
    columns. Schedule-linked elements are always element_type='fixed' (see
    app/services/cost_sync.py), so BAC/AC are simply budget/actuals, no
    percentage-element resolution needed. start/finish are the activity's live,
    current dates (not bl_start/bl_finish — see _linked_activity_dates).
    data_date is the period's own data date (scheduling_cpm.data_date_for_period
    — moved by Reschedule), not necessarily today. Reuses _schedule_evm/
    _cost_side_evm so these numbers are always identical to what Cost Plan
    shows for the same line, never a second, independently-derived set."""
    bac = Decimal(str(element.budget)) if element.budget is not None else None
    ac = Decimal(str(element.actuals)) if element.actuals is not None else None
    pv, ev, sv, spi = _schedule_evm(element.budget, element.pct_complete, start, finish, data_date)
    cv, cpi, eac, etc = _cost_side_evm(bac, ac, ev)
    return {
        "bac": bac, "ac": ac, "pv": pv, "ev": ev,
        "cv": cv, "sv": sv, "cpi": cpi, "spi": spi, "eac": eac, "etc": etc,
    }


def _apply_computed(
    element: CostElement,
    sub_budget: Decimal,
    sub_forecast: Decimal,
    sub_actuals: Decimal,
    gfa_m2: Decimal | None,
    activity_dates: tuple[datetime | None, datetime | None] | None = None,
    data_date: date | None = None,
) -> CostElementResponse:
    data = CostElementResponse.model_validate(element)

    if activity_dates is not None:
        data.pv, data.ev, data.sv, data.spi = _schedule_evm(
            element.budget, element.pct_complete, activity_dates[0], activity_dates[1], data_date or date.today()
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
    # "schedule"-sourced elements linked to a scheduled activity (has live start/finish
    # — see _schedule_evm/activity_dates above). Every other element still leaves
    # PV/EV/SV/SPI null rather than showing a fake number (e.g. SPI would always equal
    # pct_complete/100 exactly without a real schedule position to compare to).
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

    data.cv, data.cpi, data.eac, data.etc = _cost_side_evm(bac, ac, ev)
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
    activity_dates = await _linked_activity_dates(db, elements)
    data_dates = await _period_data_dates(db, {el.period_id for el in elements})

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
        results.append(_apply_computed(
            el, *subs, gfa_m2, activity_dates.get(el.linked_activity_id), data_dates.get(el.period_id)
        ))
    return results


async def get_cost_element(db: AsyncSession, element_id: uuid.UUID) -> CostElementResponse:
    el = await db.get(CostElement, element_id)
    if el is None:
        raise HTTPException(status_code=404, detail="Cost element not found")
    gfa_m2 = await _project_gfa(db, el.project_id)
    activity_dates = await _linked_activity_dates(db, [el])
    data_dates = await _period_data_dates(db, {el.period_id})
    if el.element_type == "percentage":
        subs = await _fixed_subtotals(db, el.project_id, el.period_id)
    else:
        subs = (Decimal(0), Decimal(0), Decimal(0))
    return _apply_computed(
        el, *subs, gfa_m2, activity_dates.get(el.linked_activity_id), data_dates.get(el.period_id)
    )


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
