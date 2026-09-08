from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.calendar import Calendar
from app.models.cost_baseline import CostBaseline, CostBaselineItem
from app.models.cost_element import CostElement
from app.models.period import Period
from app.models.project import Project
from app.schemas.cost_element import (
    ActualsHistoryItem,
    ActualsHistoryResponse,
    CostElementCreate,
    CostElementResponse,
    CostElementUpdate,
    FyBreakdownPoint,
    FyBreakdownResponse,
)
from app.services.fiscal_year import fiscal_year_bounds, fiscal_year_label, fiscal_years_spanning, overlap_days
from app.services.reference_codes import next_code
from app.services.scheduling_cpm import (
    _build_calendar_lookup,
    _CalendarLookup,
    data_date_time_for_period,
    default_day_start_times,
    elapsed_duration_fraction,
)

_MONEY = Decimal("0.01")
_RATIO = Decimal("0.0001")


async def _get_eac_method(db: AsyncSession, project_id: uuid.UUID) -> str:
    """The project's chosen EAC formula (Project.eac_method — see that
    column's own docstring for what each value means), fetched fresh
    rather than assumed 'cpi' so every EAC/ETC figure in the app actually
    reflects a project's own setting the moment it's changed. Falls back to
    'cpi' if the project row is somehow gone by the time this runs (never
    actually reachable in practice — every caller already holds a live
    project_id) rather than raising, matching this app's "best-available,
    never a hard failure over a display formula" convention."""
    project = await db.get(Project, project_id)
    return project.eac_method if project is not None else "cpi"


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
    bac: Decimal | None, actuals: Decimal | None, pct_complete: int | None, method: str = "cpi"
) -> Decimal | None:
    """One fixed element's own EAC (Estimate at Completion), or its bac
    before any progress has been assessed — used to cascade a percentage
    element's own forecast up from the fixed elements underneath it, so an
    on-cost genuinely reflects those elements' performance (a fixed line
    running over its approved BAC pushes Prelims/Overhead/etc.'s own
    forecast up too, not just a static rate of the live budget). bac here
    must already be resolved (bl_budget-with-live-fallback — see
    CostElement.bl_budget's own docstring), same input _apply_computed's
    own unified bac/eac path uses for that same fixed element.

    method (2026-09-08, Project.eac_method — see that column's own
    docstring): 'typical' (AC+(BAC-EV)/(CPI x SPI)) is never available
    here — this cascade works from a raw SQL aggregate (_fixed_subtotals)
    with no schedule linkage at all, so there's no SPI to use — and
    silently behaves as 'cpi' instead, same "best-available fallback, not
    a hard failure" rule _get_eac_method itself follows."""
    if bac is None:
        return None
    bac = Decimal(str(bac))
    if method == "atypical" and pct_complete is not None and actuals is not None:
        ev = bac * Decimal(pct_complete) / Decimal(100)
        return (Decimal(str(actuals)) + (bac - ev)).quantize(_MONEY)
    if pct_complete is not None and actuals is not None:
        actuals = Decimal(str(actuals))
        if actuals != 0:
            ev = bac * Decimal(pct_complete) / Decimal(100)
            cpi = ev / actuals
            if cpi != 0:
                return (bac / cpi).quantize(_MONEY)
    return bac.quantize(_MONEY)


async def _fixed_subtotals(
    db: AsyncSession, project_id: uuid.UUID, period_id: uuid.UUID, method: str = "cpi"
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
            _element_eac_or_bac(r.bl_budget if r.bl_budget is not None else r.budget, r.actuals, r.pct_complete, method)
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
) -> dict[uuid.UUID, tuple[datetime | None, datetime | None, uuid.UUID | None, Decimal | None]]:
    """BASELINE start/finish when one has been captured, live (current,
    CPM-computed) start/finish otherwise (+ the activity's own calendar_id,
    since elapsed_duration_fraction needs one) for every schedule-sourced
    element's linked activity, in one batched query — the input Planned
    Value needs. 2026-09-06, per Maro, reverting an earlier "confirmed
    correction" after real evidence proved it wrong: checked against a
    genuine P6-exported EVM table for four real in-progress activities at
    once, PV computed from LIVE dates matched none of them, while PV from
    BASELINE dates matched three exactly and the fourth within a point —
    see app/services/activity.py:_attach_evm_fields's own header for the
    full comparison. Elements with no linked activity, or that have been
    manually unlinked, are simply absent from the result.

    duration_hours (2026-09-07, per Maro: Cost Plan's own group % Complete
    should match Scheduling's "% COMP" for the same WBS branch, not
    schedule_pct_complete) — the linked activity's own duration_hours, so a
    group rollup can weight by it the exact same way _recompute_hierarchy's
    own WBS rollup does (app/services/activity.py's own rollup()), instead
    of the budget-weighted average CostElementResponse.bac would otherwise
    imply."""
    activity_ids = {
        el.linked_activity_id for el in elements
        if el.source == "schedule" and el.linked_activity_id is not None
    }
    if not activity_ids:
        return {}
    result = await db.execute(
        select(
            Activity.id, Activity.start, Activity.finish, Activity.calendar_id,
            Activity.bl_start, Activity.bl_finish, Activity.duration_hours,
        ).where(Activity.id.in_(activity_ids))
    )
    return {
        row.id: (
            (row.bl_start, row.bl_finish) if row.bl_start is not None and row.bl_finish is not None
            else (row.start, row.finish)
        ) + (row.calendar_id, row.duration_hours)
        for row in result.all()
    }


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
    lookup: "_CalendarLookup",
    calendar: Calendar,
) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None]:
    """Planned Value (Rita Mulcahy Ch.9: "as of today, the estimated value of work
    planned to be done") via working-day proration across start/finish against
    the data date — "Activity % Complete" (duration elapsed), distinct from
    the manually-assessed Physical % Complete that drives EV. Working-day
    proration, matching real P6 exactly (2026-09-04, per Maro — see
    elapsed_duration_fraction's own header for the full derivation), via the
    activity's own resolved calendar (lookup+calendar). start/finish are
    whichever of baseline/live the caller already resolved (2026-09-06 — see
    _linked_activity_dates/_attach_evm_fields's own headers for why baseline
    wins when captured). bac is the resolved Budget At Completion
    (bl_budget-with-live-fallback, see CostElement.bl_budget's own
    docstring) — every caller already resolves this before calling in,
    never a raw live budget field directly. EV/SV/SPI follow directly from
    PV once it exists. Returns (pv, ev, sv, spi) — any of which can be None
    if the inputs aren't there yet (no bac, the activity isn't scheduled
    yet, no progress assessed)."""
    fraction = elapsed_duration_fraction(lookup, calendar, start, finish, data_date)
    if bac is None or fraction is None:
        return None, None, None, None
    bac = Decimal(str(bac))

    pv = (bac * fraction).quantize(_MONEY)
    ev = (bac * Decimal(pct_complete) / Decimal(100)).quantize(_MONEY) if pct_complete is not None else None
    sv = (ev - pv).quantize(_MONEY) if ev is not None else None
    spi = (ev / pv).quantize(_RATIO) if ev is not None and pv != 0 else None
    return pv, ev, sv, spi


def _cost_side_evm(
    bac: Decimal | None, ac: Decimal | None, ev: Decimal | None,
    spi: Decimal | None = None, method: str = "cpi",
) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None]:
    """CV/CPI/EAC/ETC from BAC/AC/EV — extracted so this stays the one place these
    formulas live, shared by _apply_computed (Cost Plan) and
    compute_schedule_linked_evm (Scheduling's EVM columns) rather than drifting
    into two copies.

    method (2026-09-08, Project.eac_method — see that column's own
    docstring, added per Maro: "depending on the EAC formula we may get
    different results... I want a general setting to choose what method to
    use") selects which PMBOK EAC formula to use; CPI/CV are unaffected —
    they're inputs to every formula, not something a method changes.
    'atypical' needs no SPI. 'typical' needs a real spi — pass None (the
    default) wherever no genuine schedule position exists for this figure
    (e.g. a non-schedule-linked Cost Plan line) and it silently behaves as
    'cpi' instead, same "best-available fallback" rule _get_eac_method
    itself follows, rather than leaving EAC blank over a method that simply
    doesn't apply here."""
    cv = (ev - ac).quantize(_MONEY) if ev is not None and ac is not None else None
    cpi = (ev / ac).quantize(_RATIO) if ev is not None and ac is not None and ac != 0 else None

    eac: Decimal | None = None
    if method == "atypical" and bac is not None and ac is not None and ev is not None:
        # PMBOK "atypical variance" EAC = AC + (BAC - EV) — assumes today's
        # cost variance was a one-off and remaining work returns to the
        # original planned rate.
        eac = (ac + (bac - ev)).quantize(_MONEY)
    elif (
        method == "typical" and bac is not None and ac is not None and ac != 0
        and ev is not None and ev != 0 and spi is not None and spi != 0
    ):
        # PMBOK "typical variance" EAC = AC + (BAC-EV)/(CPI x SPI) — full-
        # precision cpi_raw here, not the already-rounded `cpi` above, for
        # the same reason the default formula below uses full-precision
        # ac/ev rather than the rounded cpi (see this function's own
        # 'cpi'-branch comment).
        cpi_raw = ev / ac
        eac = (ac + (bac - ev) / (cpi_raw * spi)).quantize(_MONEY)
    elif bac is not None and ac is not None and ac != 0 and ev is not None and ev != 0:
        # Default 'cpi' method (EAC = BAC / CPI), also the fallback for
        # 'typical' whenever no real spi was passed in. Computed as
        # BAC * AC / EV directly rather than dividing by the already-
        # rounded `cpi` above — P6's own EAC/ETC report figures only match
        # to the penny (verified 2026-09-06 against Juniper's real EVM
        # export) when the full-precision ratio is used; routing through
        # the display-rounded CPI first compounded up to a real ~£1 error
        # on some activities (e.g. "Fab & Delivery": 30948.33 vs P6's
        # 30947.37).
        eac = (bac * ac / ev).quantize(_MONEY)

    etc = (eac - ac).quantize(_MONEY) if eac is not None and ac is not None else None
    return cv, cpi, eac, etc


def rollup_evm_from_totals(
    bac: Decimal | None, ac: Decimal | None, pv: Decimal | None, ev: Decimal | None, method: str = "cpi"
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
    the exact same formula _schedule_evm uses per-element.

    Also returns schedule_pct_complete (2026-09-06, per Maro, tracing a real
    "15.6% vs P6's 12.8%" mismatch on a real project rollup): a WBS
    summary's own start/finish span its *entire* subtree — running
    elapsed_duration_fraction against that whole span (what
    _attach_evm_fields does for every OTHER activity, since it has no way
    to know a row is a rollup) measures "how far through the whole
    project's date range are we," a completely different, much coarser
    question than "how much of the summed budget should be earned by now."
    schedule_pct_complete = PV/BAC is the exact same identity every leaf's
    own PV is already defined by (PV = BAC x schedule_pct_complete/100) —
    applying it here instead just answers it correctly at the rollup level,
    from the real summed PV/BAC rather than an unrelated calendar span."""
    sv = (ev - pv).quantize(_MONEY) if ev is not None and pv is not None else None
    spi = (ev / pv).quantize(_RATIO) if ev is not None and pv is not None and pv != 0 else None
    cv, cpi, eac, etc = _cost_side_evm(bac, ac, ev, spi=spi, method=method)
    schedule_pct_complete = (
        (pv / bac * Decimal(100)).quantize(Decimal("0.01")) if pv is not None and bac is not None and bac != 0 else None
    )
    return {
        "bac": bac, "ac": ac, "pv": pv, "ev": ev, "cv": cv, "sv": sv, "cpi": cpi, "spi": spi, "eac": eac, "etc": etc,
        "schedule_pct_complete": schedule_pct_complete,
    }


def compute_schedule_linked_evm(
    element: CostElement, start: datetime | None, finish: datetime | None, data_date: datetime,
    lookup: "_CalendarLookup", calendar: Calendar, method: str = "cpi",
) -> dict[str, Decimal | None]:
    """AC/PV/EV/CV/SV/CPI/SPI/BAC/EAC/ETC for a single schedule-linked cost
    element — used by app/services/activity.py to surface these as Scheduling
    columns. Schedule-linked elements are always element_type='fixed' (see
    app/services/cost_sync.py), so AC is simply actuals, no percentage-element
    resolution needed. BAC is bl_budget if a Cost Baseline has been assigned to
    this element, else its live budget as a fallback (2026-09-03, per Maro's
    domain correction — see CostElement.bl_budget's own docstring). start/finish
    are whichever of baseline/live the caller already resolved (2026-09-06 —
    see _linked_activity_dates's own header for why baseline wins when
    captured). data_date is the period's own data date
    (scheduling_cpm.data_date_for_period — moved by Reschedule), not necessarily
    today. lookup/calendar are the activity's own resolved calendar — see
    elapsed_duration_fraction's own header for why PV now needs one. Reuses
    _schedule_evm/_cost_side_evm so these numbers are always identical to what
    Cost Plan shows for the same line, never a second, independently-derived
    set."""
    bac = element.bl_budget if element.bl_budget is not None else element.budget
    bac = Decimal(str(bac)) if bac is not None else None
    ac = Decimal(str(element.actuals)) if element.actuals is not None else None
    pv, ev, sv, spi = _schedule_evm(bac, element.pct_complete, start, finish, data_date, lookup, calendar)
    cv, cpi, eac, etc = _cost_side_evm(bac, ac, ev, spi=spi, method=method)
    bl_budget = Decimal(str(element.bl_budget)) if element.bl_budget is not None else None
    return {
        "bac": bac, "ac": ac, "pv": pv, "ev": ev,
        "cv": cv, "sv": sv, "cpi": cpi, "spi": spi, "eac": eac, "etc": etc,
        # The raw, un-fallback-applied approved figure (2026-09-07, per
        # Maro: "also capture column for BL Budget so i can see the figure
        # independent of BAC") — null until a Cost Baseline has actually
        # been assigned to this element, same distinction
        # CostElement.bl_budget's own docstring already draws; `bac` above
        # is this-with-a-live-fallback, so the two read identically once a
        # baseline is assigned and diverge (bl_budget blank, bac showing
        # the live budget) whenever one isn't.
        "bl_budget": bl_budget,
    }


def _apply_computed(
    element: CostElement,
    sub_budget: Decimal,
    sub_forecast: Decimal,
    sub_actuals: Decimal,
    gfa_m2: Decimal | None,
    activity_dates: tuple[datetime | None, datetime | None, uuid.UUID | None, Decimal | None] | None = None,
    data_date: datetime | None = None,
    lookup: "_CalendarLookup | None" = None,
    method: str = "cpi",
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
        data.linked_activity_duration_hours = activity_dates[3]
    if activity_dates is not None and lookup is not None:
        activity_calendar = lookup.resolve_calendar_id(activity_dates[2])
        data.pv, data.ev, data.sv, data.spi = _schedule_evm(
            bac, element.pct_complete, activity_dates[0], activity_dates[1], data_date or datetime.now(),
            lookup, activity_calendar,
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

    data.cv, data.cpi, data.eac, data.etc = _cost_side_evm(bac, ac, ev, spi=data.spi, method=method)
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
    lookup = await _build_calendar_lookup(db, project_id)
    method = await _get_eac_method(db, project_id)

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
        fixed_subs = await _fixed_subtotals(db, project_id, period_id, method)
        period_bases[period_id] = _cascade_bases(fixed_subs, period_elements)

    results = []
    for el in elements:
        if el.element_type == "percentage":
            subs = period_bases[el.period_id][el.id]
        else:
            subs = (Decimal(0), Decimal(0), Decimal(0))
        results.append(_apply_computed(
            el, *subs, gfa_m2, activity_dates.get(el.linked_activity_id), data_dates.get(el.period_id), lookup,
            method=method,
        ))
    return results


async def get_cost_element(db: AsyncSession, element_id: uuid.UUID) -> CostElementResponse:
    el = await db.get(CostElement, element_id)
    if el is None:
        raise HTTPException(status_code=404, detail="Cost element not found")
    gfa_m2 = await _project_gfa(db, el.project_id)
    activity_dates = await _linked_activity_dates(db, [el])
    data_dates = await _period_data_dates(db, {el.period_id})
    lookup = await _build_calendar_lookup(db, el.project_id)
    method = await _get_eac_method(db, el.project_id)
    if el.element_type == "percentage":
        fixed_subs = await _fixed_subtotals(db, el.project_id, el.period_id, method)
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
        el, *subs, gfa_m2, activity_dates.get(el.linked_activity_id), data_dates.get(el.period_id), lookup,
        method=method,
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


async def get_fy_breakdown(db: AsyncSession, project_id: uuid.UUID, period_id: uuid.UUID) -> FyBreakdownResponse:
    """Portfolio-wide Budget/BL Budget/Actuals/Forecast, one column per UK
    fiscal year (2026-09-08, per Maro: "I'd like to see it per year... this
    should apply to Budgets (Baselines too), Actuals and Forecast").

    Budget/BL Budget are real: each schedule-linked element's own BAC/
    bl_budget is spread evenly across its linked activity's own [start,
    finish] by calendar day (the exact same "cost accrues evenly across
    duration" assumption dashboard.py:_kpis's own bottom-up EAC already
    uses) and apportioned into whichever FY those days fall in. Elements
    with no real schedule link at all (manual, or no dates) go into
    unscheduled_budget/unscheduled_bl_budget instead of an arbitrary year.

    Actuals/Forecast are never invented (per Maro: "these should just be
    saved when baselines exist... I'm not saying you should magic any
    number"). For a past FY, both figures come verbatim from whichever real
    CostBaseline was captured latest within that FY — a genuine recorded
    snapshot, or null if none was ever captured that year. The one FY
    containing today is different: its actuals is the real LIVE total
    (cumulative to today — actuals_is_ytd=True), and per Maro's own
    correction ("no, forecast can be reprofiled" — a forecast is a
    projection, not a recorded fact the way actuals is) its forecast
    combines that same real live actuals-to-date with the live ETC's own
    day-weighted share of whatever's left in the FY, using the exact same
    real day-weighting Budget above already computed
    (forecast_is_reprofiled=True). A future FY with no snapshot gets a
    purely reprofiled forecast (100% ETC share, no actuals yet); a PAST FY
    with no snapshot at all is left fully blank — no anchor exists to
    reprofile from, and inventing one would be exactly the "magic number"
    Maro asked not to show."""
    elements = await list_cost_elements(db, project_id, period_id)
    activity_dates = await _linked_activity_dates(db, elements)
    method = await _get_eac_method(db, project_id)
    data_dates = await _period_data_dates(db, {period_id})
    today = data_dates[period_id].date() if period_id in data_dates else date.today()

    # --- Determine the FY span: every activity's own dates, plus whatever
    # FY today falls in (so a not-yet-resourced or fully-complete project
    # still gets at least a "current year" column). ---
    span_starts: list[date] = []
    span_ends: list[date] = []
    for el in elements:
        if el.source == "schedule" and el.linked_activity_id is not None:
            dates = activity_dates.get(el.linked_activity_id)
            if dates and dates[0] is not None and dates[1] is not None:
                span_starts.append(dates[0].date())
                span_ends.append(dates[1].date())
    span_start = min([*span_starts, today])
    span_end = max([*span_ends, today])
    fy_years = fiscal_years_spanning(span_start, span_end)

    # --- Budget/BL Budget: real, day-weighted across each element's own
    # linked activity dates. ---
    budget_by_fy: dict[int, Decimal] = {y: Decimal(0) for y in fy_years}
    bl_budget_by_fy: dict[int, Decimal] = {y: Decimal(0) for y in fy_years}
    has_budget_by_fy: dict[int, bool] = {y: False for y in fy_years}
    has_bl_budget_by_fy: dict[int, bool] = {y: False for y in fy_years}
    unscheduled_budget = Decimal(0)
    unscheduled_bl_budget = Decimal(0)
    has_unscheduled_bl_budget = False
    for el in elements:
        dates = activity_dates.get(el.linked_activity_id) if el.linked_activity_id else None
        if el.source != "schedule" or dates is None or dates[0] is None or dates[1] is None:
            if el.bac is not None:
                unscheduled_budget += el.bac
            if el.bl_budget is not None:
                unscheduled_bl_budget += el.bl_budget
                has_unscheduled_bl_budget = True
            continue
        a_start, a_finish = dates[0].date(), dates[1].date()
        total_days = (a_finish - a_start).days + 1
        if total_days <= 0:
            continue
        for y in fy_years:
            fy_start, fy_end = fiscal_year_bounds(y)
            days = overlap_days(a_start, a_finish, fy_start, fy_end)
            if days == 0:
                continue
            share = Decimal(days) / Decimal(total_days)
            if el.bac is not None:
                budget_by_fy[y] += (el.bac * share).quantize(_MONEY)
                has_budget_by_fy[y] = True
            if el.bl_budget is not None:
                bl_budget_by_fy[y] += (el.bl_budget * share).quantize(_MONEY)
                has_bl_budget_by_fy[y] = True

    # --- Actuals/Forecast: real captured CostBaseline snapshots only. ---
    baselines = (await db.execute(
        select(CostBaseline).where(CostBaseline.period_id == period_id)
        .order_by(CostBaseline.baseline_date.asc(), CostBaseline.created_at.asc())
    )).scalars().all()
    snapshot_items_by_baseline_id: dict[uuid.UUID, list[CostBaselineItem]] = {}
    if baselines:
        all_items = (await db.execute(
            select(CostBaselineItem).where(CostBaselineItem.baseline_id.in_([b.id for b in baselines]))
        )).scalars().all()
        for item in all_items:
            snapshot_items_by_baseline_id.setdefault(item.baseline_id, []).append(item)

    def _snapshot_totals(baseline_id: uuid.UUID) -> tuple[Decimal, Decimal, Decimal]:
        items = snapshot_items_by_baseline_id.get(baseline_id, [])
        bac_total = sum((i.bac for i in items), Decimal(0))
        ac_total = sum((i.ac for i in items if i.ac is not None), Decimal(0))
        ev_total = sum(
            (i.bac * Decimal(i.pct_complete) / Decimal(100) for i in items if i.pct_complete is not None),
            Decimal(0),
        )
        return bac_total, ac_total, ev_total

    # Latest baseline captured within each FY (chronological, so "latest" is
    # just the last one whose own year matches, since `baselines` is already
    # date-ordered).
    latest_baseline_by_fy: dict[int, CostBaseline] = {}
    for b in baselines:
        y = fiscal_years_spanning(b.baseline_date, b.baseline_date)[0]
        latest_baseline_by_fy[y] = b

    # Live current totals — every real, resolved cost element right now,
    # same aggregation dashboard.py:_kpis already does for the portfolio.
    live_bac_total = live_ac_total = live_ev_total = Decimal(0)
    has_live_cost_evm = False
    for el in elements:
        if el.bac is None:
            continue
        ac = el.computed_actuals if el.element_type == "percentage" else el.actuals
        has_live_cost_evm = True
        live_bac_total += el.bac
        if ac is not None:
            live_ac_total += ac
        if el.pct_complete is not None:
            live_ev_total += el.bac * Decimal(el.pct_complete) / Decimal(100)
    live_eac = (
        rollup_evm_from_totals(live_bac_total, live_ac_total, None, live_ev_total, method)["eac"]
        if has_live_cost_evm else None
    )
    live_etc = (live_eac - live_ac_total).quantize(_MONEY) if live_eac is not None else None
    current_fy = fiscal_years_spanning(today, today)[0]

    points: list[FyBreakdownPoint] = []
    for y in fy_years:
        fy_start, fy_end = fiscal_year_bounds(y)
        is_current = y == current_fy
        snapshot = latest_baseline_by_fy.get(y)
        actuals: Decimal | None = None
        actuals_is_ytd = False
        forecast: Decimal | None = None
        forecast_is_reprofiled = False

        if is_current:
            actuals = live_ac_total if has_live_cost_evm else None
            actuals_is_ytd = True
            if live_etc is not None:
                # Whatever's left of the FY beyond today gets its day-weighted
                # share of the live ETC; the elapsed part is already covered
                # by the real live actuals-to-date above — not double-counted,
                # since ETC by definition excludes what's already been spent.
                remaining_days = overlap_days(today, fy_end, fy_start, fy_end)
                fy_days = (fy_end - fy_start).days + 1
                remaining_share = Decimal(remaining_days) / Decimal(fy_days) if fy_days else Decimal(0)
                forecast = (live_ac_total + live_etc * remaining_share).quantize(_MONEY)
                forecast_is_reprofiled = True
            elif snapshot is not None:
                # No live cost data exists at all right now (has_live_cost_evm
                # False) but a real snapshot was captured this year — fall
                # back to that snapshot's own recorded forecast rather than
                # leaving a genuinely-known figure blank.
                snap_bac, snap_ac, snap_ev = _snapshot_totals(snapshot.id)
                forecast = rollup_evm_from_totals(snap_bac, snap_ac, None, snap_ev, method)["eac"]
        elif y > current_fy:
            # A future FY: nothing real has happened yet, but its own share
            # of the live remaining cost can still be reprofiled.
            if live_etc is not None:
                fy_days = (fy_end - fy_start).days + 1
                days_in_fy = overlap_days(fy_start, fy_end, today, fy_end)
                share = Decimal(days_in_fy) / Decimal(fy_days) if fy_days else Decimal(0)
                forecast = (live_etc * share).quantize(_MONEY)
                forecast_is_reprofiled = True
        elif snapshot is not None:
            # A past FY with a real captured baseline in it.
            snap_bac, snap_ac, snap_ev = _snapshot_totals(snapshot.id)
            actuals = snap_ac
            forecast = rollup_evm_from_totals(snap_bac, snap_ac, None, snap_ev, method)["eac"]
        # A past FY with no snapshot at all stays fully blank — no real
        # anchor to derive anything from.

        points.append(FyBreakdownPoint(
            label=fiscal_year_label(y), start_date=fy_start, end_date=fy_end,
            budget=budget_by_fy[y] if has_budget_by_fy[y] else None,
            bl_budget=bl_budget_by_fy[y] if has_bl_budget_by_fy[y] else None,
            actuals=actuals, actuals_is_ytd=actuals_is_ytd,
            forecast=forecast, forecast_is_reprofiled=forecast_is_reprofiled,
        ))

    return FyBreakdownResponse(
        points=points,
        unscheduled_budget=unscheduled_budget if unscheduled_budget != 0 else None,
        unscheduled_bl_budget=unscheduled_bl_budget if has_unscheduled_bl_budget else None,
    )


async def get_actuals_history(db: AsyncSession, project_id: uuid.UUID, period_id: uuid.UUID) -> ActualsHistoryResponse:
    """Every schedule-linked cost element's resolved BAC/AC/EAC at each real
    captured CostBaseline snapshot, chronological (2026-09-08, per Maro: "in
    the past there is budget and actuals and even forecast bars... in
    future there is budgeted and forecast but no actuals" — corrected from
    an earlier wrong assumption that no time-phased actuals data exists at
    all; Maro pointed out the real, established Actual Hours/Days
    conversion on a schedule-linked activity, which — while itself backed
    by the same single cumulative actuals figure, not a separate hours
    record — proves converting cost history to hours via an activity's own
    resource rate is already this app's own accepted convention, not a new
    invention).

    Deliberately returns raw per-snapshot figures rather than pre-bucketing
    them into periods — the Resource Usage Profile/Resource Tracking
    widgets already own arbitrary-granularity bucket arrays (day/week/
    month/quarter/year, whichever zoom the user picked) and already know
    each activity's linked resource(s) and rate for the hours/days
    conversion; duplicating any of that here would just be a second,
    independently-drifting copy. The frontend finds, for each bucket
    boundary, the latest snapshot at-or-before it, and takes the delta
    between consecutive boundaries for that bucket's own Actual — the same
    "real snapshot, delta between two points, never an invented smooth
    curve" rule get_fy_breakdown already established for the Fiscal Year
    panel, just generalized to whatever buckets the caller already has
    instead of fixed fiscal years."""
    method = await _get_eac_method(db, project_id)

    elements_result = await db.execute(
        select(CostElement.id, CostElement.linked_activity_id).where(
            CostElement.project_id == project_id, CostElement.period_id == period_id,
            CostElement.source == "schedule", CostElement.linked_activity_id.is_not(None),
        )
    )
    activity_id_by_element_id = {row.id: row.linked_activity_id for row in elements_result.all()}
    if not activity_id_by_element_id:
        return ActualsHistoryResponse(items=[])

    baselines = (await db.execute(
        select(CostBaseline).where(CostBaseline.period_id == period_id)
        .order_by(CostBaseline.baseline_date.asc(), CostBaseline.created_at.asc())
    )).scalars().all()
    if not baselines:
        return ActualsHistoryResponse(items=[])
    baseline_date_by_id = {b.id: b.baseline_date for b in baselines}

    snapshot_items = (await db.execute(
        select(CostBaselineItem).where(
            CostBaselineItem.baseline_id.in_([b.id for b in baselines]),
            CostBaselineItem.cost_element_id.in_(activity_id_by_element_id.keys()),
        )
    )).scalars().all()

    items = []
    for s in snapshot_items:
        bac = Decimal(str(s.bac))
        ac = Decimal(str(s.ac)) if s.ac is not None else Decimal(0)
        ev = bac * Decimal(s.pct_complete) / Decimal(100) if s.pct_complete is not None else None
        _, _, eac, _ = _cost_side_evm(bac, ac, ev, method=method)
        items.append(ActualsHistoryItem(
            baseline_id=s.baseline_id, baseline_date=baseline_date_by_id[s.baseline_id],
            cost_element_id=s.cost_element_id, linked_activity_id=activity_id_by_element_id[s.cost_element_id],
            bac=bac, ac=ac, eac=eac,
        ))
    items.sort(key=lambda i: i.baseline_date)
    return ActualsHistoryResponse(items=items)
