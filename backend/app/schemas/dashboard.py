from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class DashboardKpis(BaseModel):
    planned_finish: datetime | None
    # on_time | delayed | unknown (no top-level finish/baseline yet)
    planned_finish_status: str
    open_issues: int
    open_changes: int
    schedule_spi: Decimal | None
    bac: Decimal | None
    eac: Decimal | None
    cpi: Decimal | None


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
    top_risks: list[TopRisk]
    risk_overview: RiskOverview
    risk_exposure: list[RiskExposureBand]


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
