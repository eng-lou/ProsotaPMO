import { api } from '@/lib/api'

// Trend-across-baselines charts (2026-09-03, per Maro: "Do a trend chart for
// Risk EMV, do for CPI, SPI, Cost EAC, Issues, Changes and Decisions Status
// changes... more comprehensive analysis, not just a snapshot but we have
// baseline data/s, being able to see the trend is important") — same
// "genuinely different data source gets its own fetch" precedent
// milestoneTrend.ts already established, applied to the other three
// baseline-bearing pillars plus SPI (see backend/app/services/dashboard.py's
// get_risk_emv_trend/get_cost_performance_trend/get_spi_trend/
// get_icd_open_items_trend for the exact aggregation each one reuses).

export interface RiskEmvTrendPoint {
  baseline_id: string | null
  baseline_name: string
  baseline_date: string
  open_count: number
  emv_cost_total: string
  emv_schedule_days_total: string
}

export async function getRiskEmvTrend(periodId: string): Promise<RiskEmvTrendPoint[]> {
  const { data } = await api.get<{ points: RiskEmvTrendPoint[] }>('/api/v1/dashboard/risk-emv-trend', {
    params: { period_id: periodId },
  })
  return data.points
}

export interface CostPerformanceTrendPoint {
  baseline_id: string | null
  baseline_name: string
  baseline_date: string
  bac: string | null
  cpi: string | null
  eac: string | null
}

export async function getCostPerformanceTrend(periodId: string): Promise<CostPerformanceTrendPoint[]> {
  const { data } = await api.get<{ points: CostPerformanceTrendPoint[] }>('/api/v1/dashboard/cost-performance-trend', {
    params: { period_id: periodId },
  })
  return data.points
}

export interface SpiTrendPoint {
  baseline_set_id: string | null
  baseline_name: string
  baseline_date: string
  spi: string | null
}

export async function getSpiTrend(projectId: string): Promise<SpiTrendPoint[]> {
  const { data } = await api.get<{ points: SpiTrendPoint[] }>('/api/v1/dashboard/spi-trend', {
    params: { project_id: projectId },
  })
  return data.points
}

export interface PvEvAcTrendPoint {
  baseline_set_id: string | null
  baseline_name: string
  baseline_date: string
  pv: string | null
  ev: string | null
  ac: string | null
}

// PV/EV/AC Trend (2026-09-04, per Maro — the classic PMBOK Figure 4 S-curve,
// but sampled at baseline captures instead of continuous calendar time). See
// backend/app/services/dashboard.py's get_pv_ev_ac_trend for why PV/EV/AC
// here are scoped to schedule-linked cost elements only, same population
// SPI Trend already uses — PV has no meaning for cost with no linked
// activity to give it a timeline.
export async function getPvEvAcTrend(projectId: string): Promise<PvEvAcTrendPoint[]> {
  const { data } = await api.get<{ points: PvEvAcTrendPoint[] }>('/api/v1/dashboard/pv-ev-ac-trend', {
    params: { project_id: projectId },
  })
  return data.points
}

export interface IcdOpenItemsTrendPoint {
  baseline_id: string | null
  baseline_name: string
  baseline_date: string
  open_issues: number
  open_changes: number
  open_decisions: number
}

export async function getIcdOpenItemsTrend(periodId: string): Promise<IcdOpenItemsTrendPoint[]> {
  const { data } = await api.get<{ points: IcdOpenItemsTrendPoint[] }>('/api/v1/dashboard/icd-open-items-trend', {
    params: { period_id: periodId },
  })
  return data.points
}
