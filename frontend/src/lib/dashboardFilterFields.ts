import type { FilterOperator } from '@/modules/scheduling/types'
import type { DashboardOverviewResponse } from '@/modules/dashboard/types'

// Per-widget-type field registry for the dashboard filter editor's field
// dropdown (2026-09-02, per Maro: "you need to make this a drop down" —
// DashboardWidgetFilterEditor.tsx originally took a free-text field name,
// which its own design-rationale comment called out as a fiddly fallback
// worth revisiting if it proved awkward in practice; it did, on the very
// first live click). Mirrors, field-for-field, the exhaustive lists
// documented in propose_create_dashboard_layout's own tool description
// (backend/app/ai/tools.py) — that's the authoritative source, checked
// there directly against the backend *Summary Pydantic schemas. `id` and
// other internal UUID fields (activity_id) are deliberately left out here
// even though Poe's own list includes them — Poe gets real UUIDs from
// find_records, but a human editing this dropdown never has one to type,
// so they're not a usable filter target from this UI.

export type DashboardFieldType = 'text' | 'number' | 'date' | 'boolean'

export interface DashboardFieldDef {
  key: string
  label: string
  type: DashboardFieldType
}

const TEXT_OPERATORS: FilterOperator[] = ['eq', 'neq', 'contains', 'starts_with']
const NUMBER_OPERATORS: FilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
const DATE_OPERATORS: FilterOperator[] = NUMBER_OPERATORS
const BOOLEAN_OPERATORS: FilterOperator[] = ['is_true', 'is_false']

export function operatorsForType(type: DashboardFieldType): FilterOperator[] {
  switch (type) {
    case 'number': return NUMBER_OPERATORS
    case 'date': return DATE_OPERATORS
    case 'boolean': return BOOLEAN_OPERATORS
    default: return TEXT_OPERATORS
  }
}

const RISK_FIELDS: DashboardFieldDef[] = [
  { key: 'code', label: 'Code', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'area', label: 'Area', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'risk_owner', label: 'Risk Owner', type: 'text' },
  { key: 'risk_type', label: 'Risk Type (threat/opportunity)', type: 'text' },
  { key: 'response_strategy', label: 'Response Strategy', type: 'text' },
  { key: 'rating', label: 'Rating', type: 'number' },
  { key: 'emv_cost', label: 'EMV Cost', type: 'number' },
  { key: 'emv_schedule_days', label: 'EMV Schedule (days)', type: 'number' },
  { key: 'date_raised', label: 'Date Raised', type: 'date' },
]

const COST_ELEMENT_FIELDS: DashboardFieldDef[] = [
  { key: 'code', label: 'Code', type: 'text' },
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'element_group', label: 'Element Group', type: 'text' },
  { key: 'cost_owner', label: 'Cost Owner', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'bac', label: 'BAC', type: 'number' },
  { key: 'ac', label: 'AC', type: 'number' },
  { key: 'pct_complete', label: '% Complete', type: 'number' },
  { key: 'cpi', label: 'CPI', type: 'number' },
  { key: 'eac', label: 'EAC', type: 'number' },
  { key: 'vac', label: 'VAC', type: 'number' },
]

const RESOURCE_ASSIGNMENT_FIELDS: DashboardFieldDef[] = [
  { key: 'resource_name', label: 'Resource Name', type: 'text' },
  { key: 'resource_type', label: 'Resource Type', type: 'text' },
  { key: 'discipline', label: 'Discipline', type: 'text' },
  { key: 'company', label: 'Company', type: 'text' },
  { key: 'role', label: 'Role', type: 'text' },
  { key: 'budget', label: 'Budget', type: 'number' },
  { key: 'activity_task_name', label: 'Activity Name', type: 'text' },
]

const ICD_ITEM_FIELDS: DashboardFieldDef[] = [
  { key: 'code', label: 'Code', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'item_type', label: 'Item Type (issue/change/decision)', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'priority', label: 'Priority', type: 'text' },
  { key: 'owner', label: 'Owner', type: 'text' },
  { key: 'raised_date', label: 'Raised Date', type: 'date' },
  { key: 'due_date', label: 'Due Date', type: 'date' },
  { key: 'closed_date', label: 'Closed Date', type: 'date' },
  { key: 'severity', label: 'Severity', type: 'text' },
  { key: 'decision_maker', label: 'Decision Maker', type: 'text' },
  { key: 'required_by', label: 'Required By', type: 'date' },
  { key: 'ccb_decision', label: 'CCB Decision', type: 'text' },
  { key: 'cost_impact', label: 'Cost Impact', type: 'number' },
  { key: 'schedule_impact_days', label: 'Schedule Impact (days)', type: 'number' },
]

const SCHEDULE_ACTIVITY_FIELDS: DashboardFieldDef[] = [
  { key: 'code', label: 'Code', type: 'text' },
  { key: 'task_name', label: 'Activity Name', type: 'text' },
  { key: 'start', label: 'Start', type: 'date' },
  { key: 'finish', label: 'Finish', type: 'date' },
  { key: 'bl_finish', label: 'Baseline Finish', type: 'date' },
  { key: 'variance_days', label: 'Variance (days)', type: 'number' },
  { key: 'total_float_hours', label: 'Total Float (h)', type: 'number' },
  { key: 'is_critical', label: 'Critical', type: 'boolean' },
  { key: 'pct_complete', label: '% Complete', type: 'number' },
  { key: 'schedule_category', label: 'Schedule Category', type: 'text' },
  { key: 'suspend_date', label: 'Suspend Date', type: 'date' },
  { key: 'resume_date', label: 'Resume Date', type: 'date' },
  // A dotted materialized path (e.g. "1.2.3") — pick "starts with" to scope
  // to an entire WBS subtree, not just one exact activity (see
  // dashboardFilters.ts's own wbs_path+starts_with branch).
  { key: 'wbs_path', label: 'WBS Path', type: 'text' },
]

const MILESTONE_FIELDS: DashboardFieldDef[] = [
  { key: 'task_name', label: 'Milestone Name', type: 'text' },
  { key: 'finish', label: 'Finish', type: 'date' },
  { key: 'bl_finish', label: 'Baseline Finish', type: 'date' },
  { key: 'is_critical', label: 'Critical', type: 'boolean' },
  { key: 'variance_days', label: 'Variance (days)', type: 'number' },
]

// LookaheadItem — a different shape from ScheduleActivitySummary (no
// wbs_path/udf; has has_incomplete_predecessor instead), so its own list
// rather than reusing SCHEDULE_ACTIVITY_FIELDS.
const LOOKAHEAD_ITEM_FIELDS: DashboardFieldDef[] = [
  { key: 'code', label: 'Code', type: 'text' },
  { key: 'task_name', label: 'Activity Name', type: 'text' },
  { key: 'start', label: 'Start', type: 'date' },
  { key: 'finish', label: 'Finish', type: 'date' },
  { key: 'pct_complete', label: '% Complete', type: 'number' },
  { key: 'total_float_hours', label: 'Total Float (h)', type: 'number' },
  { key: 'is_critical', label: 'Critical', type: 'boolean' },
  { key: 'has_incomplete_predecessor', label: 'Has Incomplete Predecessor', type: 'boolean' },
]

const MITIGATION_ACTION_FIELDS: DashboardFieldDef[] = [
  { key: 'risk_code', label: 'Risk Code', type: 'text' },
  { key: 'code', label: 'Action Code', type: 'text' },
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'owner', label: 'Owner', type: 'text' },
  { key: 'due_date', label: 'Due Date', type: 'date' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'pct_complete', label: '% Complete', type: 'number' },
]

const CLASH_PAIR_FIELDS: DashboardFieldDef[] = [
  { key: 'test_name', label: 'Test Name', type: 'text' },
  { key: 'element_a_label', label: 'Element A', type: 'text' },
  { key: 'element_b_label', label: 'Element B', type: 'text' },
  { key: 'distance_mm', label: 'Distance (mm)', type: 'number' },
  { key: 'status', label: 'Status (new/reviewed/approved)', type: 'text' },
]

type UdfEntity = 'activity' | 'cost_element' | 'resource'

// One entry per widget_type in FILTERABLE_WIDGET_TYPES (widgets.tsx) —
// widgets sharing an underlying record type share the same field list, so
// e.g. every data.risks-driven widget (charts and tables alike) offers the
// same dropdown even though only some of them render a table.
const WIDGET_FIELD_MAP: Record<string, { fields: DashboardFieldDef[]; udfEntity?: UdfEntity }> = {
  // Risk
  top_risks: { fields: RISK_FIELDS },
  risk_register_table: { fields: RISK_FIELDS },
  risks_by_category: { fields: RISK_FIELDS },
  risks_by_owner: { fields: RISK_FIELDS },
  threats_vs_opportunities: { fields: RISK_FIELDS },
  response_strategy_breakdown: { fields: RISK_FIELDS },
  risk_ageing_table: { fields: RISK_FIELDS },
  // Cost
  cost_elements_table: { fields: COST_ELEMENT_FIELDS, udfEntity: 'cost_element' },
  cost_breakdown_by_group: { fields: COST_ELEMENT_FIELDS, udfEntity: 'cost_element' },
  cost_breakdown_by_owner: { fields: COST_ELEMENT_FIELDS, udfEntity: 'cost_element' },
  budget_utilisation: { fields: COST_ELEMENT_FIELDS, udfEntity: 'cost_element' },
  bac_vs_eac_by_group: { fields: COST_ELEMENT_FIELDS, udfEntity: 'cost_element' },
  // Issues/Changes/Decisions
  open_items_by_owner: { fields: ICD_ITEM_FIELDS },
  issues_by_status: { fields: ICD_ITEM_FIELDS },
  issues_ageing_table: { fields: ICD_ITEM_FIELDS },
  decisions_pending_table: { fields: ICD_ITEM_FIELDS },
  changes_by_ccb_decision: { fields: ICD_ITEM_FIELDS },
  // Resources
  resource_assignments_table: { fields: RESOURCE_ASSIGNMENT_FIELDS, udfEntity: 'resource' },
  resource_budget_by_type: { fields: RESOURCE_ASSIGNMENT_FIELDS, udfEntity: 'resource' },
  resource_budget_by_discipline: { fields: RESOURCE_ASSIGNMENT_FIELDS, udfEntity: 'resource' },
  resource_budget_by_company: { fields: RESOURCE_ASSIGNMENT_FIELDS, udfEntity: 'resource' },
  top_resources_by_budget: { fields: RESOURCE_ASSIGNMENT_FIELDS, udfEntity: 'resource' },
  // Schedule activities
  baseline_variance_table: { fields: SCHEDULE_ACTIVITY_FIELDS, udfEntity: 'activity' },
  critical_activities_table: { fields: SCHEDULE_ACTIVITY_FIELDS, udfEntity: 'activity' },
  near_critical_watch_list: { fields: SCHEDULE_ACTIVITY_FIELDS, udfEntity: 'activity' },
  float_distribution: { fields: SCHEDULE_ACTIVITY_FIELDS, udfEntity: 'activity' },
  activities_by_category: { fields: SCHEDULE_ACTIVITY_FIELDS, udfEntity: 'activity' },
  activity_status: { fields: SCHEDULE_ACTIVITY_FIELDS, udfEntity: 'activity' },
  // Milestones
  milestones_table: { fields: MILESTONE_FIELDS },
  milestone_timeline: { fields: MILESTONE_FIELDS },
  // Smaller, single-widget data sources
  lookahead_planner: { fields: LOOKAHEAD_ITEM_FIELDS },
  mitigation_actions_table: { fields: MITIGATION_ACTION_FIELDS },
  clash_detail_table: { fields: CLASH_PAIR_FIELDS },
}

function udfRecords(data: DashboardOverviewResponse, entity: UdfEntity): { udf: Record<string, string> }[] {
  switch (entity) {
    case 'cost_element': return data.cost_elements
    case 'resource': return data.resource_assignments
    case 'activity': return data.schedule_activities
  }
}

// Discovers real UDF definition names from the widget's own already-fetched
// data rather than a fixed list — UDF definitions are per-project and can't
// be known statically. Uses the exact keys of each record's own `udf` dict,
// prefixed 'udf.' per dashboardFilters.ts's own convention, so a selected
// option is always guaranteed to match at least one real record right now.
export function dashboardFieldOptions(widgetType: string, data: DashboardOverviewResponse | undefined): DashboardFieldDef[] {
  const entry = WIDGET_FIELD_MAP[widgetType]
  if (!entry) return []
  if (!entry.udfEntity || !data) return entry.fields
  const names = new Set<string>()
  for (const record of udfRecords(data, entry.udfEntity)) {
    for (const name of Object.keys(record.udf)) names.add(name)
  }
  const udfFields: DashboardFieldDef[] = [...names].sort().map(name => ({
    key: `udf.${name}`, label: `UDF: ${name}`, type: 'text',
  }))
  return [...entry.fields, ...udfFields]
}
