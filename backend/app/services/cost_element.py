from __future__ import annotations

import uuid
from datetime import datetime, time
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
from app.services.scheduling_cpm import data_date_time_for_period, default_day_start_times, elapsed_duration_fraction

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


def _element_eac_or_bac(
    bac: Decimal | None, actuals: Decimal | None, pct_complete: int | None
) -> Decimal | None:
    """One fixed element's own EAC (Estimate at Completion), or its bac
    before any progress has been assessed — used to cascade a percentage
    element's own forecast up from the fixed elements underneath it, so an
    on-cost genuinely reflects those elements' performance (a fixed line
    running over its approved BAC pushes Prelims/Overhead/etc.'s own
    forecast up too, not just a static rate of the live budget). bac here
    must already be resolved (bl_budget-with-live-fallback — see
    CostElement.bl_budget's own docstring), same input _apply_computed's
    own unified bac/eac path uses for that same fixed element."""
    if bac is None:
        return None
    bac = Decimal(str(bac))
    if pct_complete is not None and actuals is not None:
        actuals = Decimal(str(actuals))
        if actuals != 0:
            ev = bac * Decimal(pct_complete) / Decimal(100)
            cpi = ev / actuals
            if cpi != 0:
                return (bac / cpi).quantize(_MONEY)
    return bac.quantize(_MONEY)


async def _fixed_subtotals(
    db: AsyncSession, project_id: uuid.UUID, period_id: uuid.UUID
) -> tuple[Decimal, Decimal, Decimal]:
    """Return (sum_budget, sum_forecast, sum_actuals) for all fixed elements
    in this project/period. sum_budget is the live-estimate cascade base for
    a percentage element's own computed_budget (unchanged meaning).
    sum_forecast is the cascade base for computed_forecast — each fixed
    row's own _element_eac_or_bac (using ITS resolved bac: bl_budget-with-
    live-fallback), not a raw budget-based figure. A percentage element's
    own BAC does NOT reuse this cascade (2026-09-03, per Maro's domain
    correction): CostBaselineItem.bac already resolved it once at capture
    time (see cost_baseline.py:create_baseline), and assign_baseline copies
    that resolved figure straight onto CostElement.bl_budget for every
    element, percentage included — a flat, verbatim copy, no runtime
    re-cascading needed for BAC itself, only for the forecast cascade above."""
    q = select(CostElement.budget, CostElement.bl_budget, CostElement.actuals, CostElement.pct_complete).where(
        CostElement.project_id == project_id,
        CostElement.period_id == period_id,
        CostElement.element_type == "fixed",
    )
    rows = (await db.execute(q)).all()
    sum_budget = sum((Decimal(str(r.budget)) for r in rows if r.budget is not None), Decimal(0))
    sum_actuals = sum((Decimal(str(r.actuals)) for r in rows if r.actuals is not None), Decimal(0))
    sum_forecast = sum(
        (
            _element_eac_or_bac(r.bl_budget if r.bl_budget is not None else r.budget, r.actuals, r.pct_complete)
            or Decimal(0)
            for r in rows
        ),
        Decimal(0),
    )
    return sum_budget, sum_forecast, sum_actuals


# NRM1's own cascade order (2026-07-27, per Maro's QS review: "same rates,
# correct order" — works cost estimate -> main contractor's OH&P -> building
# works estimate -> project/design team fees -> base cost estimate -> risk
# allowances -> cost limit -> inflation). Matched by description, the same
# way _CONTINGENCY_DESCRIPTION already identifies that one specific line
# elsewhere (risk_bulk_generate.py) — these four are the only percentage
# on-costs this platform generates, so a whitelist by name is enough; a
# custom percentage line a user adds by hand with some other description
# has no known position in this sequence and keeps the old (parallel,
# fixed-subtotal-only) behaviour rather than being silently slotted in
# somewhere wrong.
NRM1_CASCADE_ORDER: tuple[str, ...] = ("Overhead", "Design Fees", "Contingency (Risk-Derived)", "Inflation")


def _cascade_bases(
    fixed_subs: tuple[Decimal, Decimal, Decimal],
    percentage_elements: list[CostElement],
) -> dict[uuid.UUID, tuple[Decimal, Decimal, Decimal]]:
    """Each recognised on-cost applies to the running total left by every
    on-cost before it in NRM1's sequence, not to the same raw fixed subtotal
    in parallel — the previous behaviour understated the total (~1.3% on a
    real project) because fees were never charged on overhead, and inflation
    was never applied to risk or fees. Contingency's own rate is still
    exactly what risk_bulk_generate.py froze from the real EMV total at
    generation time (total_emv_cost / fixed_total then) — only the base it's
    re-multiplied against here changes when this is read later, same as
    Overhead/Fees/Inflation. budget/forecast/actuals each cascade against
    their own running total independently, since they can genuinely differ
    once progress has been assessed."""
    order_index = {name: i for i, name in enumerate(NRM1_CASCADE_ORDER)}
    ordered = sorted(
        (el for el in percentage_elements if el.description in order_index),
        key=lambda el: order_index[el.description],
    )
    other = [el for el in percentage_elements if el.description not in order_index]

    bases: dict[uuid.UUID, tuple[Decimal, Decimal, Decimal]] = {}
    running = fixed_subs
    for el in ordered:
        bases[el.id] = running
        if el.rate is not None:
            rate = Decimal(str(el.rate))
            running = (
                running[0] + (rate * running[0]).quantize(_MONEY),
                running[1] + (rate * running[1]).quantize(_MONEY),
                running[2] + (rate * running[2]).quantize(_MONEY),
            )
    for el in other:
        bases[el.id] = fixed_subs
    return bases


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


async def _period_data_dates(db: AsyncSession, period_ids: set[uuid.UUID]) -> dict[uuid.UUID, datetime]:
    """Each period's full data date+time, batched — see
    app/services/scheduling_cpm.py:data_date_time_for_period, the same anchor
    the CPM engine schedules from."""
    if not period_ids:
        return {}
    periods = list((await db.execute(select(Period).where(Period.id.in_(period_ids)))).scalars().all())
    default_starts = await default_day_start_times(db, {p.project_id for p in periods})
    return {
        p.id: data_date_time_for_period(p, default_starts.get(p.project_id, time(8, 0)))
        for p in periods
    }


def _schedule_evm(
    bac: Decimal | None,
    pct_complete: int | None,
    start: datetime | None,
    finish: datetime | None,
    data_date: datetime,
) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None]:
    """Planned Value (Rita Mulcahy Ch.9: "as of today, the estimated value of work
    planned to be done") via linear proration across the activity's own current
    start/finish against the data date — "Activity % Complete" (duration
    elapsed), distinct from the manually-assessed Physical % Complete that
    drives EV. Day-granularity proration (consistent with variance_days staying
    day-based post-Phase-10; a documented interpretation, not a rigorously-
    derived one, same as the DCMA thresholds elsewhere in this codebase). bac
    is the resolved Budget At Completion (bl_budget-with-live-fallback, see
    CostElement.bl_budget's own docstring) — every caller already resolves
    this before calling in, never a raw live budget field directly.
    EV/SV/SPI follow directly from PV once it exists. Returns (pv, ev, sv, spi)
    — any of which can be None if the inputs aren't there yet (no bac, the
    activity isn't scheduled yet, no progress assessed)."""
    fraction = elapsed_duration_fraction(start, finish, data_date)
    if bac is None or fraction is None:
        return None, None, None, None
    bac = Decimal(str(bac))

    pv = (bac * fraction).quantize(_MONEY)
    ev = (bac * Decimal(pct_complete) / Decimal(100)).quantize(_MONEY) if pct_complete is not None else None
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


def rollup_evm_from_totals(
    bac: Decimal | None, ac: Decimal | None, pv: Decimal | None, ev: Decimal | None
) -> dict[str, Decimal | None]:
    """SV/SPI/CV/CPI/EAC/ETC from already-*summed* BAC/AC/PV/EV — a WBS
    summary's own EVM (app/services/activity.py's _rollup_wbs_evm_fields,
    2026-07-15, per Maro: "rollup the bac and eac and etc"). BAC/PV/EV/AC are
    the only EVM quantities that are ever valid to sum across a WBS
    (PMBOK) — every other figure here is a *ratio* or a value derived from
    one, and must be recomputed fresh from the summed totals at the level
    it's being read, never summed or averaged directly: a WBS with a $100
    task at CPI 0.5 next to a $1,000,000 task at CPI 1.0 rolls up to a
    cumulative CPI of ~0.9998 (999,900/1,000,000... in this made-up example,
    roughly EV/AC at the WBS level), not (0.5+1.0)/2 = 0.75 — averaging the
    ratios themselves would silently misrepresent which task actually drives
    the WBS's real cost performance. SV/SPI aren't part of _cost_side_evm
    (that function is BAC/AC/EV only, no PV) so computed here directly with
    the exact same formula _schedule_evm uses per-element."""
    sv = (ev - pv).quantize(_MONEY) if ev is not None and pv is not None else None
    spi = (ev / pv).quantize(_RATIO) if ev is not None and pv is not None and pv != 0 else None
    cv, cpi, eac, etc = _cost_side_evm(bac, ac, ev)
    return {"bac": bac, "ac": ac, "pv": pv, "ev": ev, "cv": cv, "sv": sv, "cpi": cpi, "spi": spi, "eac": eac, "etc": etc}


def compute_schedule_linked_evm(
    element: CostElement, start: datetime | None, finish: datetime | None, data_date: datetime
) -> dict[str, Decimal | None]:
    """AC/PV/EV/CV/SV/CPI/SPI/BAC/EAC/ETC for a single schedule-linked cost
    element — used by app/services/activity.py to surface these as Scheduling
    columns. Schedule-linked elements are always element_type='fixed' (see
    app/services/cost_sync.py), so AC is simply actuals, no percentage-element
    resolution needed. BAC is bl_budget if a Cost Baseline has been assigned to
    this element, else its live budget as a fallback (2026-09-03, per Maro's
    domain correction — see CostElement.bl_budget's own docstring). start/finish
    are the activity's live, current dates (not bl_start/bl_finish — see
    _linked_activity_dates). data_date is the period's own data date
    (scheduling_cpm.data_date_for_period — moved by Reschedule), not necessarily
    today. Reuses _schedule_evm/_cost_side_evm so these numbers are always
    identical to what Cost Plan shows for the same line, never a second,
    independently-derived set."""
    bac = element.bl_budget if element.bl_budget is not None else element.budget
    bac = Decimal(str(bac)) if bac is not None else None
    ac = Decimal(str(element.actuals)) if element.actuals is not None else None
    pv, ev, sv, spi = _schedule_evm(bac, element.pct_complete, start, finish, data_date)
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
    data_date: datetime | None = None,
) -> CostElementResponse:
    data = CostElementResponse.model_validate(element)

    if element.element_type == "percentage" and element.rate is not None:
        rate = Decimal(str(element.rate))
        data.computed_budget = (rate * sub_budget).quantize(_MONEY)
        data.computed_actuals = (rate * sub_actuals).quantize(_MONEY)
        # Cascaded from the fixed elements underneath (_element_eac_or_bac per
        # row, via _fixed_subtotals) — a genuine aggregate of THEIR own EAC
        # performance, not a static rate of the live budget, so an on-cost
        # like Prelims/Overhead correctly moves when what it's a percentage
        # OF is running over or under its own approved BAC.
        data.computed_forecast = (rate * sub_forecast).quantize(_MONEY)

    # current_estimate = the live, continuously-revised figure (computed_budget's
    # cascade for a percentage element, budget for a fixed one) — Maro's own
    # framing, 2026-09-03: "the budget field in cost plan is a forecast." Used
    # for comparison_variance/cost_per_m2 (independent benchmarking tools that
    # track the current plan, not formal EVM) and as bac's own fallback.
    #
    # bac = the true Budget At Completion every EVM formula below actually
    # needs — element.bl_budget if a Cost Baseline has ever been assigned
    # (services/cost_baseline.py:assign_baseline copies CostBaselineItem.bac
    # onto bl_budget verbatim for every element, percentage included — no
    # runtime re-cascading needed, since CostBaselineItem.bac was already
    # resolved once at capture time), else current_estimate as a fallback
    # before that's ever happened.
    current_estimate = data.computed_budget if element.element_type == "percentage" else element.budget
    current_estimate = Decimal(str(current_estimate)) if current_estimate is not None else None
    bac = Decimal(str(element.bl_budget)) if element.bl_budget is not None else current_estimate
    data.bac = bac

    ac = data.computed_actuals if element.element_type == "percentage" else element.actuals
    ac = Decimal(str(ac)) if ac is not None else None

    # Cost-side EVM (CV/CPI/EAC/ETC/VAC/TCPI) is computed here unconditionally. Schedule-
    # side EVM (PV/EV/SV/SPI) needed a genuine time-phased planned value — "how much
    # should have been done by this date on the schedule" — which only exists for
    # "schedule"-sourced elements linked to a scheduled activity (has live start/finish
    # — see _schedule_evm/activity_dates above). Every other element still leaves
    # PV/EV/SV/SPI null rather than showing a fake number (e.g. SPI would always equal
    # pct_complete/100 exactly without a real schedule position to compare to).
    if activity_dates is not None:
        data.pv, data.ev, data.sv, data.spi = _schedule_evm(
            bac, element.pct_complete, activity_dates[0], activity_dates[1], data_date or datetime.now()
        )

    # Drift since the last approved baseline — null (not a misleadingly precise
    # £0) until a Cost Baseline has actually been assigned to this element,
    # since bac is otherwise just current_estimate reflected back at itself.
    if element.bl_budget is not None and current_estimate is not None:
        data.variance = (current_estimate - bac).quantize(_MONEY)

    if current_estimate is not None and element.comparison_cost is not None:
        data.comparison_variance = (current_estimate - Decimal(str(element.comparison_cost))).quantize(_MONEY)

    if current_estimate is not None and gfa_m2 is not None:
        data.cost_per_m2 = (current_estimate / gfa_m2).quantize(_MONEY)

    ev: Decimal | None = None
    if bac is not None and element.pct_complete is not None:
        ev = (bac * Decimal(element.pct_complete) / Decimal(100)).quantize(_MONEY)

    data.cv, data.cpi, data.eac, data.etc = _cost_side_evm(bac, ac, ev)
    if bac is not None and data.eac is not None:
        data.vac = (bac - data.eac).quantize(_MONEY)
    if bac is not None and ev is not None and ac is not None and (bac - ac) != 0:
        data.tcpi = ((bac - ev) / (bac - ac)).quantize(_RATIO)

    # forecast IS the computed EAC ("what do we now expect this line to finally
    # cost"), falling back to bac before any progress has been assessed — only
    # for a fixed element (its own eac, computed above from ITS OWN bac/ac/ev).
    # A percentage element's forecast is computed_forecast instead (the
    # fixed-elements-underneath cascade above) — its own top-level data.eac is
    # usually None (percentage elements have no independent pct_complete of
    # their own to drive an EV), so falling back to `bac` here would silently
    # replace a real cascaded figure with a flat, non-performance-based one.
    if element.element_type != "percentage":
        data.forecast = data.eac if data.eac is not None else bac

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

    # Group percentage calculations by period to avoid N+1 subtotal queries,
    # then cascade each period's own percentage elements in NRM1 order
    # (_cascade_bases) rather than handing every one of them the same raw
    # fixed subtotal.
    percentage_by_period: dict[uuid.UUID, list[CostElement]] = {}
    for el in elements:
        if el.element_type == "percentage":
            percentage_by_period.setdefault(el.period_id, []).append(el)

    period_bases: dict[uuid.UUID, dict[uuid.UUID, tuple[Decimal, Decimal, Decimal]]] = {}
    for period_id, period_elements in percentage_by_period.items():
        fixed_subs = await _fixed_subtotals(db, project_id, period_id)
        period_bases[period_id] = _cascade_bases(fixed_subs, period_elements)

    results = []
    for el in elements:
        if el.element_type == "percentage":
            subs = period_bases[el.period_id][el.id]
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
        fixed_subs = await _fixed_subtotals(db, el.project_id, el.period_id)
        siblings = list((await db.execute(
            select(CostElement).where(
                CostElement.project_id == el.project_id,
                CostElement.period_id == el.period_id,
                CostElement.element_type == "percentage",
            )
        )).scalars().all())
        subs = _cascade_bases(fixed_subs, siblings)[el.id]
    else:
        subs = (Decimal(0), Decimal(0), Decimal(0))
    return _apply_computed(
        el, *subs, gfa_m2, activity_dates.get(el.linked_activity_id), data_dates.get(el.period_id)
    )


async def create_cost_element(db: AsyncSession, data: CostElementCreate) -> CostElementResponse:
    await _require_live_period(db, data.period_id)
    code = await next_code(db, CostElement, "CST", data.project_id)
    el = CostElement(**data.model_dump(), code=code)
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
