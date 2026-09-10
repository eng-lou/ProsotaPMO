from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ElementType = Literal["fixed", "percentage"]
# Workflow status only. Over Budget/Monitor/On Budget/Saving is a computed variance-band
# badge (see CostVarianceCriterion, Phase 3), not a stored status; Applied % is auto-shown
# for percentage-type elements.
CostElementStatus = Literal["approved", "cr_pending", "tbc", "credit"]


class CostElementBase(BaseModel):
    element_type: ElementType = "fixed"
    # Negative allowed (up to -100%) so a percentage element can represent a genuine
    # credit/deduction (e.g. Market Conditions Deduction), not just a positive on-cost.
    rate: Decimal | None = Field(default=None, ge=-1, le=10)
    element_group: str | None = None
    description: str
    cost_owner: str | None = None
    status: CostElementStatus | None = None
    scope_note: str | None = None
    variance_commentary: str | None = None
    qs_signoff_name: str | None = None
    qs_signoff_date: date | None = None
    budget: Decimal | None = None
    actuals: Decimal | None = None
    # Physical progress (0-100) — the real EVM input; see CostElement model docstring.
    pct_complete: int | None = Field(default=None, ge=0, le=100)
    last_reviewed_date: date | None = None
    # An independent benchmark figure (e.g. another project's equivalent
    # line) — see CostElement.comparison_cost's own docstring.
    comparison_cost: Decimal | None = None

    @model_validator(mode="after")
    def validate_type_fields(self) -> "CostElementBase":
        if self.element_type == "percentage" and self.rate is None:
            raise ValueError("rate is required for percentage elements")
        if self.element_type == "fixed" and self.rate is not None:
            raise ValueError("rate must be null for fixed elements")
        return self


class CostElementCreate(CostElementBase):
    project_id: uuid.UUID
    period_id: uuid.UUID


class CostElementUpdate(BaseModel):
    element_type: ElementType | None = None
    rate: Decimal | None = Field(default=None, ge=-1, le=10)
    element_group: str | None = None
    description: str | None = None
    cost_owner: str | None = None
    status: CostElementStatus | None = None
    scope_note: str | None = None
    variance_commentary: str | None = None
    qs_signoff_name: str | None = None
    qs_signoff_date: date | None = None
    budget: Decimal | None = None
    actuals: Decimal | None = None
    pct_complete: int | None = Field(default=None, ge=0, le=100)
    last_reviewed_date: date | None = None
    comparison_cost: Decimal | None = None


class CostElementResponse(CostElementBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    project_id: uuid.UUID
    period_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    # Resources module (Phase 2) — never accepted as create/update input, always
    # server-managed. See app/services/cost_sync.py.
    source: Literal["manual", "schedule"] = "manual"
    linked_activity_id: uuid.UUID | None = None
    # The raw, un-fallback-applied approved figure — None until a Cost Baseline has
    # ever been assigned to this element (see CostElement.bl_budget's own docstring).
    # Most consumers should read `bac` below instead, which already applies the
    # "fall back to live budget before a baseline exists" rule.
    bl_budget: Decimal | None = None
    # Populated at query time for percentage elements; None for fixed elements.
    # computed_budget is the LIVE estimate cascade (rate x sum of fixed elements'
    # own live budgets) — a percentage element's own "current forecast" figure,
    # distinct from computed_bac below.
    computed_budget: Decimal | None = None
    computed_forecast: Decimal | None = None
    computed_actuals: Decimal | None = None
    # The resolved Budget At Completion actually used by every EVM formula below
    # (2026-09-03, per Maro's domain correction — see CostElement.bl_budget's own
    # docstring): bl_budget if a Cost Baseline has been assigned, else the live
    # budget/computed_budget as a fallback before that's ever happened. Never
    # accepted as input, always derived — this is what "BAC" means everywhere
    # else in this app now reads (dashboard.py's _resolve_bac_ac, the EAC/CPI/SPI
    # trend charts, Baseline Comparison, Poe).
    bac: Decimal | None = None
    # Cost-side EVM, computed server-side — never accepted as input (same discipline as
    # Risk's EMV fix). AC = actuals, EV = BAC x pct_complete/100.
    # Schedule-side EVM (SV/SPI) is deliberately not exposed — see cost_element service.
    # forecast = EAC once progress has been assessed (they're the same concept — "what do
    # we now expect this line to finally cost"); BAC is the best available forecast
    # before then. No longer a separate manual input.
    forecast: Decimal | None = None
    # How far the current live estimate (budget/computed_budget) has drifted from
    # the approved bac — null until a Cost Baseline has actually been assigned
    # (nothing to measure drift against yet). Replaces the old rev_a_baseline-based
    # figure (frozen once at creation, never re-baselineable) with a real one tied
    # to a deliberate baseline assignment.
    variance: Decimal | None = None
    # budget (or computed_budget for a percentage element) - comparison_cost,
    # a plain difference — never accepted as input, always derived. Distinct
    # from `variance` above (live estimate vs approved bac) and from vac below
    # (bac vs eac) — three different comparisons, three different fields.
    comparison_variance: Decimal | None = None
    cost_per_m2: Decimal | None = None
    cv: Decimal | None = None
    cpi: Decimal | None = None
    eac: Decimal | None = None
    etc: Decimal | None = None
    vac: Decimal | None = None
    tcpi: Decimal | None = None
    # Schedule-side EVM (Resources module, Phase 3) — only computable for a
    # "schedule"-sourced element whose linked activity has live start/finish
    # dates (i.e. is scheduled); null otherwise, same "leave it blank rather
    # than show a fake number" discipline used everywhere else. PV is prorated
    # against the activity's own current start/finish, not a captured baseline
    # — see app/services/cost_element.py:_schedule_evm.
    pv: Decimal | None = None
    ev: Decimal | None = None
    sv: Decimal | None = None
    spi: Decimal | None = None
    # The linked activity's own duration_hours (2026-09-07, per Maro: Cost
    # Plan's own group % Complete should match Scheduling's "% COMP" for the
    # same WBS branch — which is duration-weighted, not budget-weighted, see
    # app/services/activity.py's own rollup()). Null for a manual element or
    # one whose linked activity has no duration set; a frontend group rollup
    # should exclude those from a duration-weighted average the same way
    # rollup() itself falls back to a plain average when every child has
    # zero/null weight.
    linked_activity_duration_hours: Decimal | None = None


class FyBreakdownPoint(BaseModel):
    """One UK fiscal year's own Budget/BL Budget/Actuals/Forecast, portfolio-
    wide across the whole project (2026-09-08, per Maro: "I'd like to see
    it per year... FY 10/11 Budget, FY 11/12... this should apply to
    Budgets (Baselines too), Actuals and Forecast"). See
    app/services/cost_element.py:get_fy_breakdown for exactly how each
    figure is derived and why — budget/bl_budget are real (day-weighted
    across each schedule-linked element's own activity dates, the same
    "cost accrues evenly across duration" assumption dashboard.py's own
    bottom-up EAC already uses); actuals/forecast are never invented — see
    that function's own docstring for the "saved snapshot" vs "reprofiled
    remaining" split."""
    label: str  # "FY10/11"
    start_date: date
    end_date: date
    budget: Decimal | None = None
    bl_budget: Decimal | None = None
    actuals: Decimal | None = None
    # True only for the one FY containing today/the data date — actuals is a
    # cumulative-to-date figure for that year, not yet a closed-year total,
    # same distinction Maro's own worked example drew ("cumulative figures
    # from the april to date").
    actuals_is_ytd: bool = False
    forecast: Decimal | None = None
    # True wherever forecast includes a reprofiled (not purely saved-
    # snapshot) component — per Maro: "no, forecast can be reprofiled" (a
    # forecast is a projection by nature; actuals never get this treatment).
    forecast_is_reprofiled: bool = False


class FyBreakdownResponse(BaseModel):
    points: list[FyBreakdownPoint]
    # Budget/BL Budget from cost elements with no real schedule link (a
    # manual line, or one whose activity has no dates) — real money that
    # can't honestly be assigned to any one year, so it's kept separate
    # rather than silently dumped into an arbitrary FY.
    unscheduled_budget: Decimal | None = None
    unscheduled_bl_budget: Decimal | None = None


class ActualsHistoryItem(BaseModel):
    """One schedule-linked cost element's resolved BAC/AC/EAC as recorded in
    one real captured CostBaseline snapshot (2026-09-08, per Maro: "in the
    past there is budget and actuals and even forecast bars... in future
    there is budgeted and forecast but no actuals" — the Resource Usage
    Profile/Resource Tracking's own per-period Actual/Forecast bars need a
    REAL history to derive from, never an invented one). linked_activity_id
    lets the frontend join this back onto whichever activity/resource it's
    already displaying (and convert bac/ac/eac to hours/days via that
    activity's own resource rate — the exact same "one time-based resource"
    conversion ResourceAssignments.tsx's own Actual Hours/Days toggle
    already uses), without the backend needing to know anything about
    hours, rates, or which zoom/bucket granularity the chart is using."""
    baseline_id: uuid.UUID
    baseline_date: date
    cost_element_id: uuid.UUID
    linked_activity_id: uuid.UUID
    bac: Decimal
    ac: Decimal
    eac: Decimal | None = None
    # bac x this snapshot's own captured pct_complete (2026-09-10, per Maro:
    # the Resource Usage Profile's third bar is meant to be a real EVM
    # triad — PV/EV/AC — not Budgeted/Actual/Forecast; the old "Forecast"
    # series dumped this same snapshot's whole-activity EAC into a single
    # bucket unscaled, which is what made it look wildly disproportionate
    # next to genuinely time-phased Budget/Actual bars. EV, like ac above,
    # is a real per-snapshot figure the frontend can delta between two
    # points the same "real snapshot, never a smoothed estimate" way
    # get_actuals_history's own header already establishes for ac/eac —
    # null only when this snapshot never captured a pct_complete at all.
    ev: Decimal | None = None


class ActualsHistoryResponse(BaseModel):
    # Chronological (oldest first) — one row per (baseline, schedule-linked
    # element) pair. No "live/current" point here — the caller already has
    # that from the same live Activity/CostElement fetch it's already
    # making elsewhere (activity.bac/.ac/.eac), so it isn't duplicated here.
    items: list[ActualsHistoryItem]
