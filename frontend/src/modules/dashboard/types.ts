export interface DashboardKpis {
  plan_start: string | null
  planned_finish: string | null
  planned_finish_status: 'on_time' | 'delayed' | 'unknown'
  open_issues: number
  open_changes: number
  schedule_spi: string | null
  bac: string | null
  eac: string | null
  cpi: string | null
  eac_remaining_at_plan: string | null
  eac_composite: string | null
}

export interface DcmaQualitySummary {
  activity_count: number
  logic_score: number | null
  total_checks: number
  passing_count: number
  failing_count: number
  warning_count: number
  scope_name: string | null
}

export interface ClashByTest {
  test_id: string
  test_name: string
  test_type: string
  total: number
  new_count: number
  reviewed_count: number
  approved_count: number
}

export interface ClashSummary {
  test_count: number
  total_clashes: number
  new_count: number
  reviewed_count: number
  approved_count: number
  by_test: ClashByTest[]
}

export interface ClashPairSummary {
  id: string
  test_id: string
  test_name: string
  element_a_label: string
  element_b_label: string
  distance_mm: number | null
  status: 'new' | 'reviewed' | 'approved'
}

export interface ProjectInfoSummary {
  data_date: string | null
  total_activities: number
  total_relationships: number
  total_resources: number
  has_baseline: boolean
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

export interface ScheduleActivitySummary {
  id: string
  code: string
  task_name: string
  start: string | null
  finish: string | null
  bl_finish: string | null
  variance_days: number | null
  total_float_hours: string | null
  is_critical: boolean | null
  pct_complete: string | null
  schedule_category: string | null
  suspend_date: string | null
  resume_date: string | null
  wbs_path: string | null
}

export interface LookaheadItem {
  id: string
  code: string
  task_name: string
  start: string | null
  finish: string | null
  pct_complete: string | null
  total_float_hours: string | null
  is_critical: boolean | null
  has_incomplete_predecessor: boolean
}

export interface LookaheadSummary {
  window_weeks: number
  total_in_window: number
  critical_in_window: number
  healthy_float_count: number
  incomplete_predecessor_count: number
  next_milestone_name: string | null
  next_milestone_date: string | null
}

export interface RiskMitigationActionSummary {
  id: string
  risk_id: string
  risk_code: string
  code: string
  description: string
  owner: string | null
  due_date: string | null
  status: string
  pct_complete: number
}

export interface CostElementSummary {
  id: string
  code: string
  description: string
  element_group: string | null
  cost_owner: string | null
  status: string | null
  bac: string | null
  ac: string | null
  pct_complete: number | null
  cpi: string | null
  eac: string | null
  vac: string | null
}

export interface ResourceAssignmentSummary {
  id: string
  resource_name: string
  resource_type: 'labour' | 'equipment' | 'material' | 'subcontractor' | 'cost' | 'crew'
  discipline: string | null
  company: string | null
  role: string | null
  budget: string
  activity_id: string
  activity_task_name: string
}

export interface IcdItemSummary {
  id: string
  code: string
  title: string
  item_type: 'issue' | 'change' | 'decision'
  status: string
  priority: string | null
  owner: string | null
  raised_date: string | null
  due_date: string | null
  closed_date: string | null
  severity: string | null
  decision_maker: string | null
  required_by: string | null
  ccb_decision: string | null
  cost_impact: string | null
  schedule_impact_days: number | null
}

export interface RiskSummary {
  id: string
  code: string
  title: string
  category: string | null
  area: string | null
  status: string
  risk_owner: string | null
  risk_type: 'threat' | 'opportunity'
  response_strategy: string | null
  rating: string | null
  emv_cost: string | null
  emv_schedule_days: string | null
  date_raised: string | null
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
  schedule_activities: ScheduleActivitySummary[]
  lookahead_items: LookaheadItem[]
  lookahead_summary: LookaheadSummary
  cost_elements: CostElementSummary[]
  resource_assignments: ResourceAssignmentSummary[]
  icd_items: IcdItemSummary[]
  risks: RiskSummary[]
  mitigation_actions: RiskMitigationActionSummary[]
  top_risks: TopRisk[]
  risk_overview: RiskOverview
  risk_exposure: RiskExposureBand[]
  dcma_quality: DcmaQualitySummary
  clash_summary: ClashSummary
  clash_pairs: ClashPairSummary[]
  project_info: ProjectInfoSummary
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
