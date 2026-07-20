export interface DashboardKpis {
  planned_finish: string | null
  planned_finish_status: 'on_time' | 'delayed' | 'unknown'
  open_issues: number
  open_changes: number
  schedule_spi: string | null
  bac: string | null
  eac: string | null
  cpi: string | null
}

export interface ScheduleBuckets {
  on_time: number
  at_risk: number
  delayed: number
  total: number
}

export interface MilestoneTimelineItem {
  id: string
  task_name: string
  finish: string | null
  bl_finish: string | null
  is_critical: boolean | null
  variance_days: number | null
}

export interface TopRisk {
  id: string
  code: string
  title: string
  status: string
  rating: string | null
  emv_cost: string | null
  emv_schedule_days: string | null
}

export interface RiskOverview {
  high: number
  medium: number
  low: number
  open: number
  closed: number
}

export interface RiskExposureBand {
  band: 'Low' | 'Medium' | 'High'
  emv_cost: string
}

export interface DashboardOverviewResponse {
  kpis: DashboardKpis
  schedule_buckets: ScheduleBuckets
  milestones: MilestoneTimelineItem[]
  top_risks: TopRisk[]
  risk_overview: RiskOverview
  risk_exposure: RiskExposureBand[]
}

// --- Baseline Comparison (Phase 1b) ---

export interface BaselineSet {
  id: string
  project_id: string
  name: string
  baseline_date: string
  created_at: string
  updated_at: string
}

export interface ScheduleComparisonItem {
  activity_id: string
  code: string
  task_name: string
  baseline_finish: string | null
  current_finish: string | null
  variance_days: number | null
}

export interface ScheduleComparison {
  baseline_name: string
  summary: {
    total: number
    slipped_count: number
    avg_slip_days: string | null
    baseline_spi: string | null
    current_spi: string | null
  }
  items: ScheduleComparisonItem[]
}

export interface RiskComparisonItem {
  risk_id: string
  code: string
  title: string
  baseline_rating: string | null
  current_rating: string | null
  baseline_emv_cost: string | null
  current_emv_cost: string | null
}

export interface RiskComparison {
  baseline_name: string
  summary: {
    increased_count: number
    decreased_count: number
    unchanged_count: number
    baseline_emv_cost_total: string
    current_emv_cost_total: string
  }
  items: RiskComparisonItem[]
}

export interface CostComparisonItem {
  cost_element_id: string
  code: string
  description: string
  baseline_budget: string | null
  current_budget: string | null
  baseline_cpi: string | null
  current_cpi: string | null
}

export interface CostComparison {
  baseline_name: string
  summary: {
    baseline_bac: string
    current_bac: string
    baseline_cpi: string | null
    current_cpi: string | null
    baseline_eac: string | null
    current_eac: string | null
  }
  items: CostComparisonItem[]
}

export interface IcdComparisonItem {
  icd_item_id: string
  code: string
  item_type: string
  title: string
  baseline_status: string | null
  current_status: string | null
}

export interface IcdComparisonTypeCounts {
  baseline_open: number
  current_open: number
}

export interface IcdComparison {
  baseline_name: string
  summary: {
    issue: IcdComparisonTypeCounts
    change: IcdComparisonTypeCounts
    decision: IcdComparisonTypeCounts
  }
  items: IcdComparisonItem[]
}

export interface BaselineComparisonResponse {
  baseline_set_name: string
  baseline_set_date: string
  schedule: ScheduleComparison | null
  risk: RiskComparison | null
  cost: CostComparison | null
  icd: IcdComparison | null
}
