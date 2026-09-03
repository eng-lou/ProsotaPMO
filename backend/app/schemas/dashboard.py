from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class DashboardKpis(BaseModel):
    plan_start: datetime | None
    planned_finish: datetime | None
    # on_time | delayed | unknown (no top-level finish/baseline yet)
    planned_finish_status: str
    open_issues: int
    open_changes: int
    schedule_spi: Decimal | None
    bac: Decimal | None
    eac: Decimal | None
    cpi: Decimal | None
    # Two more PMBOK EAC formulas alongside the classic BAC/CPI already above
    # (Batch 6, 2026-07-20, per the EAC Forecast Comparison gap flagged in
    # WIDGET_LIBRARY_PLAN.md §E.1) — "AC + remaining at plan rate" and the
    # SPI x CPI composite. A fourth, manual "AC + custom ETC" method from the
    # same reference is deliberately not modelled here — it's an interactive
    # what-if input, not a derived figure a read-only dashboard tile can show.
    eac_remaining_at_plan: Decimal | None
    eac_composite: Decimal | None


class DcmaQualitySummary(BaseModel):
    """Live-computed DCMA 14-point score for the whole schedule — always
    unscoped, deliberately not affected by get_overview's own WBS-node
    slicer (see dashboard.py:_dcma_quality_summary's own docstring for why:
    two of the 14 checks depend on a registered ScheduleSubproject's own
    isolated CPM pass, which an arbitrary ad-hoc WBS node has no equivalent
    of). Reuses scheduling_quality.compute_quality (the same engine the
    Scheduling module's own "Run Quality Analysis" action calls) rather
    than depending on the user having saved a SchedulingQualityRun, so the
    dashboard always reflects the schedule as it stands right now."""

    activity_count: int
    logic_score: float | None
    total_checks: int
    passing_count: int
    failing_count: int
    warning_count: int
    scope_name: str | None


class ClashByTest(BaseModel):
    test_id: uuid.UUID
    test_name: str
    test_type: str
    total: int
    new_count: int
    reviewed_count: int
    approved_count: int


class ClashSummary(BaseModel):
    """Reuses the existing Clash Detective data (ClashTest/ClashResult,
    2026-07-12) — every clash across every test in the project, never
    recomputed here (clash geometry only ever exists client-side, see
    ClashTest's own docstring)."""

    test_count: int
    total_clashes: int
    new_count: int
    reviewed_count: int
    approved_count: int
    by_test: list[ClashByTest]


class ClashPairSummary(BaseModel):
    """One clashing element pair, raw enough for a detailed clash table
    widget (test/elements/distance/status) — same "one fetch, many views"
    split every other widget batch uses. Never a second, independently-
    fetched clash list."""

    id: uuid.UUID
    test_id: uuid.UUID
    test_name: str
    element_a_label: str
    element_b_label: str
    distance_mm: float | None
    status: str


class ProjectInfoSummary(BaseModel):
    data_date: date | None
    total_activities: int
    total_relationships: int
    total_resources: int
    has_baseline: bool


class ScheduleBuckets(BaseModel):
    on_time: int
    at_risk: int
    delayed: int
    total: int


class MilestoneTimelineItem(BaseModel):
    id: uuid.UUID
    task_name: str
    finish: datetime | None
    bl_finish: datetime | None
    is_critical: bool | None
    variance_days: int | None


class ScheduleActivitySummary(BaseModel):
    """One non-summary, non-archived activity in the currently-scoped
    schedule (whole schedule, or one WBS node's own subtree, per
    get_overview's own wbs_node_activity_id/critical_only params) — raw
    enough for several Schedule-module widgets
    (float distribution, activities-by-trade, baseline variance, critical
    activities) to aggregate client-side from one shared fetch, same
    "one fetch, many views" split the six original widgets already use.
    Never a second, independently-fetched activity list."""

    id: uuid.UUID
    code: str
    task_name: str
    start: datetime | None
    finish: datetime | None
    bl_finish: datetime | None
    variance_days: int | None
    total_float_hours: Decimal | None
    is_critical: bool | None
    pct_complete: Decimal | None
    schedule_category: str | None
    # Batch 6 (2026-07-20) — lets the Activity Status widget distinguish a
    # currently-suspended activity from a plain in-progress one (Phase 11's
    # suspend/resume actuals — see Activity's own docstring). Suspended =
    # suspend_date set, resume_date not yet.
    suspend_date: datetime | None
    resume_date: datetime | None
    # 2026-09-02, per Maro: "see how we use the filters/highlights in the
    # schedule. functionality is definitely there" — a materialized dotted
    # path (e.g. "1.2.3"), the exact same field Scheduling's own Filters
    # dialog already exposes (schedulingFilters.ts's own getFieldValue),
    # matched with a starts_with condition there for "everything under
    # this WBS node," not a literal string-equals — a plain equality check
    # would only ever match one exact activity, never a subtree. Reused
    # verbatim here rather than a second, dashboard-only WBS-scoping
    # mechanism, since the real answer to "is this activity under WBS node
    # X" was already solved once.
    wbs_path: str | None
    # 2026-09-02, per Maro: "in the 4d, baseline comparison. there's a
    # filter for discipline. also the radial chart?....there's precedent" —
    # Radial Chart/Timeline Strip already scope by a real UDF value
    # (frontend scheduleScope.ts's own udf_field_definition_id/udf_value);
    # {definition_name: stringified_value} here reuses that same real data
    # for dashboard widget filtering, keyed by the definition's own NAME
    # (not its UUID) so a filter condition can read e.g. "udf.Discipline",
    # something typeable, not a UUID that would need looking up first.
    # Empty for a project with no "activity"-scoped UDFs configured.
    udf: dict[str, str] = {}


class LookaheadItem(BaseModel):
    """One task-type activity starting within the Look-Ahead Planner's own
    6-week window (Batch 8, 2026-07-20) — the frontend sub-filters this
    same list to a 2/4/6-week view rather than fetching three times, same
    "one fetch, many views" split every other widget batch uses.
    has_incomplete_predecessor is true when any of this activity's own
    predecessors (ActivityRelationship) is below 100% complete — a real
    schedule-logic check, not a guess."""

    id: uuid.UUID
    code: str
    task_name: str
    start: datetime | None
    finish: datetime | None
    pct_complete: Decimal | None
    total_float_hours: Decimal | None
    is_critical: bool | None
    has_incomplete_predecessor: bool


class LookaheadSummary(BaseModel):
    """The "Look-Ahead Intelligence" bullet counts — every figure here is a
    plain count/lookup over lookahead_items and the existing milestones
    list, never a model call (see WIDGET_LIBRARY_PLAN.md §E.4's own note on
    templated-sentence widgets being fakeable without an LLM)."""

    window_weeks: int
    total_in_window: int
    critical_in_window: int
    healthy_float_count: int
    incomplete_predecessor_count: int
    next_milestone_name: str | None
    next_milestone_date: datetime | None


class RiskMitigationActionSummary(BaseModel):
    """Every mitigation action across every risk in the period — raw
    per-action rows (owner/due_date/status/pct_complete) for a Mitigation
    Actions table widget, same "one fetch, many views" split as every
    other batch."""

    id: uuid.UUID
    risk_id: uuid.UUID
    risk_code: str
    code: str
    description: str
    owner: str | None
    due_date: date | None
    status: str
    pct_complete: int


class CostElementSummary(BaseModel):
    """Every cost element in the period, raw enough for several Cost-module
    widgets (breakdown by group/owner, budget utilisation, BAC vs EAC,
    elements table) to aggregate client-side from one shared fetch — same
    "one fetch, many views" split schedule_activities/risks already use.
    bac/ac are the already-resolved figures (computed_budget/computed_actuals
    for a percentage element, budget/actuals for a fixed one — see
    cost_element._resolve_bac_ac's own docstring), never the raw possibly-
    None budget/actuals columns a percentage element leaves blank."""

    id: uuid.UUID
    code: str
    description: str
    element_group: str | None
    cost_owner: str | None
    status: str | None
    bac: Decimal | None
    ac: Decimal | None
    pct_complete: int | None
    cpi: Decimal | None
    eac: Decimal | None
    vac: Decimal | None
    # 2026-09-02, same "real UDF-scoping precedent" as ScheduleActivitySummary's
    # own udf field below — {definition_name: stringified_value}, empty for a
    # project with no "cost_element"-scoped UDFs configured.
    udf: dict[str, str] = {}


class ResourceAssignmentSummary(BaseModel):
    """Every resource assignment in the currently-scoped schedule period,
    denormalized with its resource's own display fields (name/type/
    discipline/company) and its computed budget (resource_costing.
    compute_assignment_budget — the same formula the Resources tab and
    cost_sync's own Cost Plan sync already use, never a second,
    independently-derived figure) — raw enough for the Resources-module
    widgets (breakdown by type/discipline/company, assignments table, top
    resources by cost) to aggregate client-side from one shared fetch, same
    "one fetch, many views" split every other widget batch already uses."""

    id: uuid.UUID
    resource_name: str
    resource_type: str
    discipline: str | None
    company: str | None
    role: str | None
    budget: Decimal
    activity_id: uuid.UUID
    activity_task_name: str
    # 2026-09-02 — {definition_name: stringified_value} for this assignment's
    # own RESOURCE (entity_type="resource" UDFs are attached to Resource, not
    # ResourceAssignment), empty for a project with none configured.
    udf: dict[str, str] = {}


class IcdItemSummary(BaseModel):
    """Every issue/change/decision in the period (one shared table,
    item_type discriminator — see IcdItem's own docstring), raw enough for
    the Issues/Decisions/Changes widgets (by status, ageing, owner
    workload, decisions pending, CCB breakdown) to aggregate client-side
    from one shared fetch — same "one fetch, many views" split
    schedule_activities/risks/cost_elements already use."""

    id: uuid.UUID
    code: str
    title: str
    item_type: str
    status: str
    priority: str | None
    owner: str | None
    raised_date: date | None
    due_date: date | None
    closed_date: date | None
    severity: str | None
    decision_maker: str | None
    required_by: date | None
    ccb_decision: str | None
    cost_impact: Decimal | None
    schedule_impact_days: int | None


class RiskSummary(BaseModel):
    """Every open-or-closed risk in the period, raw enough for several
    Risk-module widgets (by category/theme, by owner, threats vs
    opportunities, response strategy, register table) to aggregate
    client-side from one shared fetch — same "one fetch, many views" split
    schedule_activities already uses for Schedule widgets. Never a second,
    independently-fetched risk list."""

    id: uuid.UUID
    code: str
    title: str
    category: str | None
    area: str | None
    status: str
    risk_owner: str | None
    risk_type: str
    response_strategy: str | None
    rating: Decimal | None
    emv_cost: Decimal | None
    emv_schedule_days: Decimal | None
    date_raised: date | None


class TopRisk(BaseModel):
    id: uuid.UUID
    code: str
    title: str
    status: str
    rating: Decimal | None
    emv_cost: Decimal | None
    emv_schedule_days: Decimal | None


class RiskOverview(BaseModel):
    high: int
    medium: int
    low: int
    open: int
    closed: int


class RiskExposureBand(BaseModel):
    band: str
    emv_cost: Decimal


class DashboardOverviewResponse(BaseModel):
    kpis: DashboardKpis
    schedule_buckets: ScheduleBuckets
    milestones: list[MilestoneTimelineItem]
    schedule_activities: list[ScheduleActivitySummary]
    lookahead_items: list[LookaheadItem]
    lookahead_summary: LookaheadSummary
    cost_elements: list[CostElementSummary]
    resource_assignments: list[ResourceAssignmentSummary]
    icd_items: list[IcdItemSummary]
    risks: list[RiskSummary]
    mitigation_actions: list[RiskMitigationActionSummary]
    top_risks: list[TopRisk]
    risk_overview: RiskOverview
    risk_exposure: list[RiskExposureBand]
    dcma_quality: DcmaQualitySummary
    clash_summary: ClashSummary
    clash_pairs: list[ClashPairSummary]
    project_info: ProjectInfoSummary


# --- Baseline Comparison (Phase 1b) ---


class ScheduleComparisonSummary(BaseModel):
    total: int
    slipped_count: int
    avg_slip_days: Decimal | None
    # Same PV/EV-based SPI Overview's own schedule_spi KPI uses (schedule-
    # linked cost elements only) — evaluated at the baseline's own capture
    # date and now, not a second, differently-derived "schedule-only" SPI.
    # None on either side whenever the underlying schedule-linked cost data
    # needed to compute it isn't there (see dashboard.py's own docstring).
    baseline_spi: Decimal | None
    current_spi: Decimal | None


class ScheduleComparisonItem(BaseModel):
    activity_id: uuid.UUID
    code: str
    task_name: str
    baseline_finish: datetime | None
    current_finish: datetime | None
    variance_days: int | None


class ScheduleComparison(BaseModel):
    baseline_name: str
    summary: ScheduleComparisonSummary
    items: list[ScheduleComparisonItem]


class RiskComparisonSummary(BaseModel):
    increased_count: int
    decreased_count: int
    unchanged_count: int
    baseline_emv_cost_total: Decimal
    current_emv_cost_total: Decimal


class RiskComparisonItem(BaseModel):
    risk_id: uuid.UUID
    code: str
    title: str
    baseline_rating: Decimal | None
    current_rating: Decimal | None
    baseline_emv_cost: Decimal | None
    current_emv_cost: Decimal | None


class RiskComparison(BaseModel):
    baseline_name: str
    summary: RiskComparisonSummary
    items: list[RiskComparisonItem]


class CostComparisonSummary(BaseModel):
    baseline_bac: Decimal
    current_bac: Decimal
    baseline_cpi: Decimal | None
    current_cpi: Decimal | None
    baseline_eac: Decimal | None
    current_eac: Decimal | None


class CostComparisonItem(BaseModel):
    cost_element_id: uuid.UUID
    code: str
    description: str
    # None on either side means "didn't exist yet" — a cost element added
    # since the baseline was captured has no baseline_budget at all, not a
    # fake £0 (see dashboard.py's own _cost_comparison docstring).
    baseline_budget: Decimal | None
    current_budget: Decimal | None
    baseline_cpi: Decimal | None
    current_cpi: Decimal | None


class CostComparison(BaseModel):
    baseline_name: str
    summary: CostComparisonSummary
    items: list[CostComparisonItem]


class IcdComparisonTypeCounts(BaseModel):
    baseline_open: int
    current_open: int


class IcdComparisonSummary(BaseModel):
    issue: IcdComparisonTypeCounts
    change: IcdComparisonTypeCounts
    decision: IcdComparisonTypeCounts


class IcdComparisonItem(BaseModel):
    icd_item_id: uuid.UUID
    code: str
    item_type: str
    title: str
    # None means "didn't exist yet" — an item raised since the baseline was
    # captured has no baseline_status at all, not a fake default.
    baseline_status: str | None
    current_status: str | None


class IcdComparison(BaseModel):
    baseline_name: str
    summary: IcdComparisonSummary
    items: list[IcdComparisonItem]


class BaselineComparisonResponse(BaseModel):
    baseline_set_name: str
    baseline_set_date: date
    schedule: ScheduleComparison | None
    risk: RiskComparison | None
    cost: CostComparison | None
    icd: IcdComparison | None


# Trend-across-baselines charts (2026-09-03, per Maro: "Do a trend chart for
# Risk EMV, do for CPI, SPI, Cost EAC, Issues, Changes and Decisions Status
# changes... more comprehensive analysis, not just a snapshot but we have
# baseline data/s, being able to see the trend is important") — the same
# "one point per saved baseline, chronological, plus a final live Current
# point" shape MilestoneTrendResponse already established, applied to the
# other three baseline-bearing pillars (Risk/Cost/ICD) plus one genuinely
# cross-pillar metric (SPI, which needs a BaselineSet's linked Schedule+Cost
# pair together, see _baseline_schedule_spi). None is always "genuinely not
# computable at that point" (no schedule-linked EVM, no BaselineSet-linked
# ScheduleBaseline, etc.), never a guessed number.
class RiskEmvTrendPoint(BaseModel):
    baseline_id: uuid.UUID | None
    baseline_name: str
    baseline_date: date
    open_count: int
    emv_cost_total: Decimal
    emv_schedule_days_total: Decimal


class RiskEmvTrendResponse(BaseModel):
    points: list[RiskEmvTrendPoint]


class CostPerformanceTrendPoint(BaseModel):
    baseline_id: uuid.UUID | None
    baseline_name: str
    baseline_date: date
    bac: Decimal | None
    cpi: Decimal | None
    eac: Decimal | None


class CostPerformanceTrendResponse(BaseModel):
    points: list[CostPerformanceTrendPoint]


class SpiTrendPoint(BaseModel):
    # Keyed to the BaselineSet, not a raw ScheduleBaseline — SPI genuinely
    # needs the sibling CostBaseline linked in the same set (see
    # _baseline_schedule_spi), so unlike Milestone Trend this can't walk
    # ScheduleBaseline alone.
    baseline_set_id: uuid.UUID | None
    baseline_name: str
    baseline_date: date
    spi: Decimal | None


class SpiTrendResponse(BaseModel):
    points: list[SpiTrendPoint]


class IcdOpenItemsTrendPoint(BaseModel):
    baseline_id: uuid.UUID | None
    baseline_name: str
    baseline_date: date
    open_issues: int
    open_changes: int
    open_decisions: int


class IcdOpenItemsTrendResponse(BaseModel):
    points: list[IcdOpenItemsTrendPoint]
