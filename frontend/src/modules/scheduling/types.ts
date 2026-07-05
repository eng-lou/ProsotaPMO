export type ActivityType = 'task' | 'milestone' | 'wbs_summary'

export const ACTIVITY_TYPES: ActivityType[] = ['task', 'milestone', 'wbs_summary']

// Fields that, if changed, prompt for a reassessment note — same user-prompted
// pattern as Risk/ICD/Cost (frontend/src/components/ReassessmentLog.tsx). start/
// finish aren't here since Phase 5 made them computed, not user-editable; duration
// is the actual editable driver of those dates, so it stands in for them.
export const REASSESSMENT_TRIGGER_FIELDS = [
  'duration_days', 'pct_complete', 'constraint_type', 'constraint_date',
] as const

export interface Activity {
  id: string
  code: string
  project_id: string
  period_id: string
  task_name: string
  activity_type: ActivityType
  // Self-referencing outline hierarchy (MS Project style — no separate WBS-dictionary
  // entity). wbs_path/sort_order are server-managed, never sent as input — see backend
  // app/services/activity.py:_recompute_hierarchy.
  parent_id: string | null
  wbs_path: string | null
  sort_order: number | null
  // Phase 10 (hour-level CPM): duration_hours is the primary input now. duration_days
  // is a computed, read-only display value (duration_hours / the resolved calendar's
  // net hours/day) — never sent as input, refreshed alongside start/finish.
  duration_hours: number | null
  duration_days: number | null
  // Computed by the CPM forward/backward pass (app/services/scheduling_cpm.py) from
  // duration + logic + calendar + constraints — never accepted as input from Phase 5
  // onward. wbs_summary rows are the exception: theirs are rollups from children.
  // Full ISO datetimes since Phase 10 (hour-of-day now genuinely matters).
  start: string | null
  finish: string | null
  actual_start: string | null
  actual_finish: string | null
  // Computed server-side (Session 16 fix, per Maro): duration_hours x (1 -
  // pct_complete/100) — never sent as input. See
  // app/services/activity.py:_apply_computed_fields.
  remaining_duration_hours: number | null
  // Computed server-side only (see backend app/services/activity.py). bl_start/
  // bl_finish/bl_duration_hours are set only by the "Set Baseline" action — null
  // until the first capture. total_float_hours/free_float_hours/is_critical are null
  // for wbs_summary rows (outside the CPM network).
  bl_start: string | null
  bl_finish: string | null
  bl_duration_hours: number | null
  variance_days: number | null
  total_float_hours: number | null
  free_float_hours: number | null
  is_critical: boolean | null
  pct_complete: string | null
  commentary: string | null
  constraint_type: ConstraintType | null
  constraint_date: string | null
  // Null = inherit the project's default calendar — see Calendar below.
  calendar_id: string | null
  created_at: string
  updated_at: string
  // "Duration % Complete" (0-100) — how far along its own current start/finish
  // this activity should be by the data date, distinct from pct_complete
  // (Physical % Complete, manually assessed, drives EV). The direct input PV
  // below is prorated from. Null until the activity is scheduled. See backend
  // app/services/activity.py:_attach_evm_fields.
  duration_pct_complete: string | null
  // EVM — sourced from this activity's linked "schedule" Cost Element (Resources
  // module); the same figures Cost Plan shows for that line. Null until the
  // activity has a resourced cost line. PV is prorated against this activity's
  // own live start/finish, not bl_start/bl_finish — Set Baseline drives
  // schedule variance (variance_days), not Planned Value — see backend
  // app/services/activity.py:_attach_evm_fields.
  bac: string | null
  ac: string | null
  pv: string | null
  ev: string | null
  cv: string | null
  sv: string | null
  cpi: string | null
  spi: string | null
  eac: string | null
  etc: string | null
  // P/W/T/M — see backend app/services/activity.py:_activity_role. Never sent
  // as input; auto-maintained alongside `code`.
  wbs_role: string
  // Archive system (2026-07-04, per Maro) — see
  // backend app/services/activity.py:archive_activity.
  is_archived: boolean
  is_archive_container: boolean
}

// One entry in an activity's append-only code-change audit trail (2026-07-04,
// per Maro: "so we know what it was before and now") — see backend
// app/models/activity_code_history.py.
export interface ActivityCodeHistory {
  id: string
  activity_id: string
  old_code: string | null
  new_code: string
  reason: 'promoted_to_wbs' | 'demoted_to_task' | 'wbs_reparented' | 'manual_edit'
  created_at: string
}

export const CODE_HISTORY_REASON_LABELS: Record<ActivityCodeHistory['reason'], string> = {
  promoted_to_wbs: 'Promoted to WBS summary',
  demoted_to_task: 'Demoted to task',
  wbs_reparented: 'Moved between top-level and nested WBS',
  manual_edit: 'Manually renamed',
}

export type ConstraintType = 'asap' | 'snet' | 'ms' | 'fnlt'

export const CONSTRAINT_TYPES: { value: ConstraintType; label: string }[] = [
  { value: 'asap', label: 'As Soon As Possible' },
  { value: 'snet', label: 'Start On or After' },
  { value: 'ms', label: 'Mandatory Start' },
  { value: 'fnlt', label: 'Finish On or Before' },
]

export type RelationshipType = 'FS' | 'SS' | 'FF' | 'SF'

export const RELATIONSHIP_TYPES: RelationshipType[] = ['FS', 'SS', 'FF', 'SF']

export interface ActivityRelationship {
  id: string
  predecessor_id: string
  successor_id: string
  relationship_type: RelationshipType
  lag_hours: number
  created_at: string
  updated_at: string
}

export interface Calendar {
  id: string
  project_id: string
  name: string
  is_project_default: boolean
  // Phase 10: hours_per_day is computed server-side (day_start_time..day_end_time
  // minus this calendar's breaks) — never sent as input, read-only display value.
  hours_per_day: string
  day_start_time: string
  day_end_time: string
  works_monday: boolean
  works_tuesday: boolean
  works_wednesday: boolean
  works_thursday: boolean
  works_friday: boolean
  works_saturday: boolean
  works_sunday: boolean
  created_at: string
  updated_at: string
}

export const WEEKDAY_FIELDS = [
  { key: 'works_monday', label: 'Mon' },
  { key: 'works_tuesday', label: 'Tue' },
  { key: 'works_wednesday', label: 'Wed' },
  { key: 'works_thursday', label: 'Thu' },
  { key: 'works_friday', label: 'Fri' },
  { key: 'works_saturday', label: 'Sat' },
  { key: 'works_sunday', label: 'Sun' },
] as const

// A recurring daily non-working window (e.g. 12:00-13:00 lunch), subtracted from
// every working day's envelope on this calendar. Phase 10 addition.
export interface CalendarBreak {
  id: string
  calendar_id: string
  label: string
  start_time: string
  end_time: string
  created_at: string
  updated_at: string
}

export interface CalendarException {
  id: string
  calendar_id: string
  label: string
  start_date: string
  end_date: string
  is_working: boolean
  // Phase 10: null (both) = whole-day exception. Set (both) = only that time window
  // on each date in range is affected, e.g. "08:00-09:00 non-working".
  start_time: string | null
  end_time: string | null
  created_at: string
  updated_at: string
}

export type QualityCheckStatus = 'pass' | 'warn' | 'fail' | 'na'

export interface QualityCheck {
  number: number
  name: string
  standard: string
  threshold_label: string
  actual: number | string | null
  status: QualityCheckStatus
  // Codes of the activities that tripped this check — empty for check 12
  // (Critical Path Test) and for any "na" check. Server-computed.
  failing_activity_codes: string[]
}

export interface QualityReport {
  period_id: string
  activity_count: number
  // null when activity_count is 0 — no activities means nothing to score,
  // not a 0%.
  logic_score: number | null
  checks: QualityCheck[]
}

// A project-editable DCMA threshold (checks 1-11 only — check 12 has no
// numeric threshold, see backend app/services/scheduling_quality_criterion.py).
export interface SchedulingQualityCriterion {
  id: string
  project_id: string
  check_number: number
  threshold: string
  created_at: string
  updated_at: string
}

// A named, saved snapshot of a Schedule Quality Analysis — "save the test to
// view again". List view omits the full report (cheap fetch); GET /{id} on
// SchedulingQualityRunResponse returns it.
export interface SchedulingQualityRunSummary {
  id: string
  period_id: string
  name: string
  created_at: string
  logic_score: number | null
  failing_count: number
  warning_count: number
}

export interface SchedulingQualityRunResponse {
  id: string
  period_id: string
  name: string
  created_at: string
  report: QualityReport
}

// Resources module (2026-07-02) — a project-scoped resource pool + per-activity
// assignments. No calendar of its own: a resource runs on whichever calendar(s)
// its assigned activities already use (docs/RESOURCES_MODULE_PLAN.md).
export type ResourceType = 'labour' | 'equipment' | 'material' | 'subcontractor'

export const RESOURCE_TYPES: ResourceType[] = ['labour', 'equipment', 'material', 'subcontractor']
export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  labour: 'Labour',
  equipment: 'Equipment/Plant',
  material: 'Material',
  subcontractor: 'Subcontractor',
}

export interface Resource {
  id: string
  project_id: string
  resource_type: ResourceType
  name: string
  // Free-choice only for material (e.g. "m3", "nr"). For labour/equipment this is
  // always "day" (rate is a day rate); for subcontractor always "lump sum" —
  // frontend-enforced, not user-editable for those two types.
  unit: string
  rate: string
  // This resource's normal full-time daily capacity in hours (e.g. 8) — only
  // meaningful for labour/equipment; informational, not a cost multiplier (an
  // assignment's utilisation_pct already expresses "how much of the day").
  max_hours_per_day: string
  created_at: string
  updated_at: string
}

export interface ResourceAssignment {
  id: string
  activity_id: string
  resource_id: string
  role: string | null
  // Which of these applies depends on the resource's type (see
  // backend app/models/resource_assignment.py): labour/equipment use
  // utilisation_pct (0-100, defaults to 100 if omitted); material uses quantity;
  // subcontractor uses neither (budget is always the resource's flat rate).
  quantity: string | null
  utilisation_pct: string | null
  // Denormalized from the linked Resource, server-computed, never sent as input —
  // see backend app/services/resource_assignment.py.
  resource_name: string
  resource_type: ResourceType
  unit: string
  rate: string
  max_hours_per_day: string
  budget: string
  created_at: string
  updated_at: string
}

// A named, saved schedule baseline (2026-07-03) — replaces the old one-shot
// "Set Baseline" overwriteable slot. "Set a baseline" (create) captures a
// snapshot without applying it; "Assign a baseline" (assign) is the separate,
// deliberate action that copies a chosen saved snapshot into every
// activity's bl_start/bl_finish/bl_duration_hours. is_active marks whichever
// baseline last had that happen — at most one per period.
export interface ScheduleBaseline {
  id: string
  period_id: string
  name: string
  baseline_date: string
  is_active: boolean
  created_at: string
  updated_at: string
  // Server-computed, never sent as input — how many activities this
  // snapshot actually covers.
  activity_count: number
}

// Custom activity-table filters (2026-07-05, per Maro, modelled on P6's own
// Filters dialog) — a "Global" tier of built-in presets (Critical/Delayed/At
// Risk, still hardcoded checkboxes in Scheduling.tsx, not represented here)
// plus a "User Defined" tier of these: named, saved, backend-persisted,
// each a list of conditions plus its own match_mode for combining them. A
// *separate* global "match All selected filters/Any selected filter" radio
// (a UI preference, not stored here) then combines whichever filters — built-
// in and custom — are currently enabled; see Scheduling.tsx's visibleActivities.
export type FilterFieldKey =
  | 'code' | 'wbs_path' | 'task_name' | 'activity_type' | 'constraint_type'
  | 'is_critical' | 'is_archived'
  | 'start' | 'finish' | 'actual_start' | 'actual_finish' | 'bl_start' | 'bl_finish' | 'constraint_date'
  | 'duration_hours' | 'duration_days' | 'remaining_duration_hours' | 'bl_duration_hours'
  | 'variance_days' | 'total_float_hours' | 'free_float_hours' | 'pct_complete' | 'duration_pct_complete'
  | 'bac' | 'ac' | 'pv' | 'ev' | 'cv' | 'sv' | 'cpi' | 'spi' | 'eac' | 'etc'

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_true' | 'is_false' | 'contains' | 'starts_with'

export interface FilterCondition {
  field: FilterFieldKey
  operator: FilterOperator
  value: string
}

export interface SchedulingFilter {
  id: string
  project_id: string
  name: string
  match_mode: 'all' | 'any'
  conditions: FilterCondition[]
  created_at: string
  updated_at: string
}

export type FilterFieldType = 'number' | 'boolean' | 'enum' | 'text' | 'date'

export interface FilterFieldDef {
  key: FilterFieldKey
  label: string
  type: FilterFieldType
  operators: FilterOperator[]
  options?: { value: string; label: string }[]
}

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤',
  is_true: 'is true', is_false: 'is false', contains: 'contains', starts_with: 'starts with',
}

const NUMBER_OPERATORS: FilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
const DATE_OPERATORS: FilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
const BOOLEAN_OPERATORS: FilterOperator[] = ['is_true', 'is_false']
const ENUM_OPERATORS: FilterOperator[] = ['eq', 'neq']
// starts_with first — the common case for wbs_path ("everything under this
// branch"), not just an exact-match lookup (2026-07-05, per Maro: "where wbs
// is (then editable)" — a free-text match against the outline, not a fixed
// preset dropdown).
const TEXT_OPERATORS: FilterOperator[] = ['starts_with', 'contains', 'eq', 'neq']

// Every field a condition can be built from — deliberately the same set the
// activity table/print columns already expose (2026-07-05, per Maro: "use
// all the relevant columns... more utility, not just preset options" — free-
// text/date inputs where that's the natural fit, e.g. "WBS starts with 1.2"
// + "Start < 28 May 2026" as two conditions of one filter, rather than only
// fixed-option dropdowns). Resource assignments aren't included — they're a
// separate joined list per activity, not a single value on it.
export const FILTER_FIELD_DEFS: FilterFieldDef[] = [
  { key: 'code', label: 'Code', type: 'text', operators: TEXT_OPERATORS },
  { key: 'wbs_path', label: 'WBS', type: 'text', operators: TEXT_OPERATORS },
  { key: 'task_name', label: 'Activity Name', type: 'text', operators: TEXT_OPERATORS },
  {
    key: 'activity_type', label: 'Activity Type', type: 'enum', operators: ENUM_OPERATORS,
    options: ACTIVITY_TYPES.map(t => ({ value: t, label: t.replace('_', ' ') })),
  },
  {
    key: 'constraint_type', label: 'Constraint', type: 'enum', operators: ENUM_OPERATORS,
    options: CONSTRAINT_TYPES.map(c => ({ value: c.value, label: c.label })),
  },
  { key: 'is_critical', label: 'Critical', type: 'boolean', operators: BOOLEAN_OPERATORS },
  { key: 'is_archived', label: 'Archived', type: 'boolean', operators: BOOLEAN_OPERATORS },
  { key: 'start', label: 'Start', type: 'date', operators: DATE_OPERATORS },
  { key: 'finish', label: 'Finish', type: 'date', operators: DATE_OPERATORS },
  { key: 'actual_start', label: 'Actual Start', type: 'date', operators: DATE_OPERATORS },
  { key: 'actual_finish', label: 'Actual Finish', type: 'date', operators: DATE_OPERATORS },
  { key: 'bl_start', label: 'BL Start', type: 'date', operators: DATE_OPERATORS },
  { key: 'bl_finish', label: 'BL Finish', type: 'date', operators: DATE_OPERATORS },
  { key: 'constraint_date', label: 'Constraint Date', type: 'date', operators: DATE_OPERATORS },
  { key: 'duration_hours', label: 'Duration (h)', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'duration_days', label: 'Duration (d)', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'remaining_duration_hours', label: 'Remaining Duration (h)', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'bl_duration_hours', label: 'BL Duration (h)', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'variance_days', label: 'Variance (d)', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'total_float_hours', label: 'Total Float (h)', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'free_float_hours', label: 'Free Float (h)', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'pct_complete', label: '% Complete', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'duration_pct_complete', label: 'Duration % Complete', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'bac', label: 'BAC', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'ac', label: 'AC', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'pv', label: 'PV', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'ev', label: 'EV', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'cv', label: 'CV', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'sv', label: 'SV', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'cpi', label: 'CPI', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'spi', label: 'SPI', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'eac', label: 'EAC', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'etc', label: 'ETC', type: 'number', operators: NUMBER_OPERATORS },
]
