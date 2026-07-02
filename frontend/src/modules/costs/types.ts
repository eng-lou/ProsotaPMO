export type CostElementStatus = 'approved' | 'cr_pending' | 'tbc' | 'credit'

export interface CostElement {
  id: string
  code: string
  project_id: string
  period_id: string
  element_type: 'fixed' | 'percentage'
  rate: string | null
  element_group: string | null
  description: string
  cost_owner: string | null
  status: CostElementStatus | null
  scope_note: string | null
  variance_commentary: string | null
  qs_signoff_name: string | null
  qs_signoff_date: string | null
  budget: string | null
  actuals: string | null
  rev_a_baseline: string | null
  pct_complete: number | null
  last_reviewed_date: string | null
  computed_budget: string | null
  computed_forecast: string | null
  computed_actuals: string | null
  // Cost-side EVM — always server-computed, never sent as input. forecast is not
  // a separate manual field — it IS the computed EAC (falling back to budget
  // before any progress exists).
  forecast: string | null
  variance: string | null
  cost_per_m2: string | null
  cv: string | null
  cpi: string | null
  eac: string | null
  etc: string | null
  vac: string | null
  tcpi: string | null
  // Schedule-side EVM (Resources module, Phase 3) — only populated for a
  // "schedule"-sourced element (source below) whose linked activity has captured
  // baseline dates; null otherwise, same "leave it blank" discipline as everything
  // else here.
  pv: string | null
  ev: string | null
  sv: string | null
  spi: string | null
  // Resources module — never sent as input, always server-managed. "schedule" =
  // this element's budget/rate lines are auto-managed from an activity's resource
  // assignments; editing budget or a rate line directly in Cost Plan unlinks it
  // to "manual" permanently. See app/services/cost_sync.py.
  source: 'manual' | 'schedule'
  linked_activity_id: string | null
  created_at: string
  updated_at: string
}

export interface CostCommitment {
  id: string
  cost_element_id: string
  po_reference: string | null
  description: string
  amount: string
  created_at: string
  updated_at: string
}

export interface CostRateLine {
  id: string
  cost_element_id: string
  description: string
  qty: string
  unit: string | null
  rate: string
  total: string
  created_at: string
  updated_at: string
}

export const ELEMENT_TYPES = ['fixed', 'percentage'] as const

export const COST_ELEMENT_STATUSES: CostElementStatus[] = ['approved', 'cr_pending', 'tbc', 'credit']
export const COST_ELEMENT_STATUS_LABELS: Record<CostElementStatus, string> = {
  approved: 'Approved',
  cr_pending: 'CR Pending',
  tbc: 'TBC',
  credit: 'Credit',
}

// Fields that, if changed, should prompt for a reassessment note — same pattern
// as Risk/ICD. Limited to string-typed fields (matching both CostElement and
// CostFormValues as strings) so the equality check doesn't false-positive on
// number vs string comparisons; pct_complete is a number and is deliberately
// excluded, same reasoning as ICD's schedule_impact_days. forecast is computed
// (not a form field) so it's excluded too.
export const REASSESSMENT_TRIGGER_FIELDS = ['status', 'budget', 'actuals', 'rate'] as const
