// milestone split into start_milestone/finish_milestone 2026-07-07, per Maro
// — a Start Milestone only has a meaningful Start (its own Finish stays
// populated equal to Start internally, since CPM needs a concrete instant to
// schedule from, but the UI shows/edits only Start); a Finish Milestone is
// the mirror. Which relationship types can target one as a successor is
// restricted accordingly (see app/services/activity_relationship.py).
export type ActivityType = 'task' | 'start_milestone' | 'finish_milestone' | 'wbs_summary'

export const ACTIVITY_TYPES: ActivityType[] = ['task', 'start_milestone', 'finish_milestone', 'wbs_summary']

export function isMilestoneType(t: ActivityType): boolean {
  return t === 'start_milestone' || t === 'finish_milestone'
}

// Fields that, if changed, prompt for a reassessment note — same user-prompted
// pattern as Risk/ICD/Cost (frontend/src/components/ReassessmentLog.tsx). start/
// finish aren't here since Phase 5 made them computed, not user-editable; duration
// is the actual editable driver of those dates, so it stands in for them.
export const REASSESSMENT_TRIGGER_FIELDS = [
  'duration_days', 'pct_complete', 'constraint_type', 'constraint_date',
] as const

// Which schedule (docs/SCHEDULE_VARIANTS_PLAN.md, private docs repo) — a
// project can have more than one (Working Schedule, Recovery Schedule, ...),
// exactly one flagged is_master at a time. No variant picker yet (that's a
// later frontend phase); frontend/src/lib/useScheduleVariant.ts always
// resolves to the project's master.
export interface ScheduleVariant {
  id: string
  project_id: string
  name: string
  variant_type: string | null
  is_master: boolean
  created_at: string
  updated_at: string
}

// Scheduling's own period concept — a field-for-field mirror of the shared
// Period (frontend/src/lib/types.ts) used by Risk/Cost/ICD, but scoped to a
// ScheduleVariant instead of a project, since a schedule variant needs its
// own live/frozen reporting history independent of Risk/Cost/ICD's.
export interface SchedulePeriod {
  id: string
  schedule_variant_id: string
  period_label: string
  freeze_status: string
  start_date: string | null
  start_time: string | null
}

export interface Activity {
  id: string
  code: string
  project_id: string
  schedule_variant_id: string
  schedule_period_id: string
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
  // P6's suspend/resume actuals (docs/SCHEDULING_GAPS_PLAN.md Phase 11) —
  // distinct from actual_start/actual_finish above: an activity can start,
  // get suspended mid-flight, then resume later. Plain user-entered facts,
  // no CPM interaction for this first cut.
  suspend_date: string | null
  resume_date: string | null
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
  // A second, scoped float calculated only within a PM-tagged sub-project's
  // own branch (docs/SUBPROJECT_FLOAT_PLAN.md, private docs repo) — null for
  // any activity outside every tagged sub-project. Never accepted as input,
  // written only by the backend's own scoped CPM pass. When nested inside
  // another tagged sub-project, reflects the *nearest* tagged ancestor.
  sub_total_float_hours: number | null
  sub_is_critical: boolean | null
  pct_complete: string | null
  commentary: string | null
  constraint_type: ConstraintType | null
  constraint_date: string | null
  // Null = inherit the project's default calendar — see Calendar below.
  calendar_id: string | null
  // Null = every element linked to this activity animates with the default
  // opacity-only profile (2026-07-22) — see fourD/animationProfiles.ts's own
  // AnimationProfile. Set once here to bulk-drive every linked element's
  // behaviour instead of assigning a profile per element; a link's own
  // animation_profile_id (ModelElementLink) still wins if it's set.
  animation_profile_id: string | null
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
  // Which ScheduleCategory/CategoryPhase (frontend/src/modules/fourD/
  // ifcScheduleExtraction.ts + scheduleGeneration.ts) this activity was
  // generated as — null for anything not IFC-generated (a synthetic WBS/
  // root/milestone node, or a hand-created activity). See
  // Activity.schedule_category's own backend docstring: purely internal
  // bookkeeping so the Resources tab's own "Generate Resources"/"Auto
  // Assign Resources" actions (2026-07-17, per Maro) can find these
  // activities again and re-derive their crew/equipment recipe, without
  // re-scanning the IFC file or parsing the freely-user-editable task_name.
  schedule_category: string | null
  schedule_phase_key: string | null
  // The real IFC-measured quantity duration_hours was computed from
  // (2026-07-18, per Maro's own QA — see backend Activity.schedule_quantity's
  // model docstring) — read by boqGeneration.ts directly instead of
  // reverse-engineering an approximation from duration_hours. Null for
  // anything not IFC-generated, or generated before this field existed.
  schedule_quantity: string | null
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

// alap and mf added 2026-07-07, per Maro — mf is ms's exact/hard-pin
// counterpart on the finish side ("Mandatory Start and Mandatory Finish," his
// own pairing, not P6's separate "Start On"/"Finish On"). alap needs no date
// at all — a relative positioning directive, not an exact one. snlt/fnet
// added 2026-07-07 (Phase 8, docs/SCHEDULING_GAPS_PLAN.md) — the remaining
// "on or before"/"on or after" pair completing the set (snet/fnlt already
// existed): snlt caps Late Start (can create negative float, same mechanism
// as fnlt capping Late Finish); fnet floors Early Finish (a real forward
// push, same mechanism as snet flooring Early Start).
export type ConstraintType = 'asap' | 'alap' | 'snet' | 'snlt' | 'ms' | 'mf' | 'fnlt' | 'fnet'

export const CONSTRAINT_TYPES: { value: ConstraintType; label: string }[] = [
  { value: 'asap', label: 'As Soon As Possible' },
  { value: 'alap', label: 'As Late As Possible' },
  { value: 'snet', label: 'Start On or After' },
  { value: 'snlt', label: 'Start On or Before' },
  { value: 'ms', label: 'Mandatory Start' },
  { value: 'mf', label: 'Mandatory Finish' },
  { value: 'fnlt', label: 'Finish On or Before' },
  { value: 'fnet', label: 'Finish On or After' },
]

export type RelationshipType = 'FS' | 'SS' | 'FF' | 'SF'

export const RELATIONSHIP_TYPES: RelationshipType[] = ['FS', 'SS', 'FF', 'SF']

// A milestone (either kind) has zero duration, so a relationship type's
// *second* letter (which successor end is nominally driven) is
// mathematically inert for it — only the *first* letter (which predecessor
// end is referenced) actually changes the computed date. A Start Milestone
// is only meaningfully driven by the predecessor's own Start (SS/SF); a
// Finish Milestone only by the predecessor's Finish (FS/FF) — mirrors
// app/services/activity_relationship.py's own validation on the backend, so
// the UI can disable the invalid options up front instead of round-tripping
// to find out (2026-07-07, per Maro).
const VALID_RELATIONSHIP_TYPES_FOR_MILESTONE: Partial<Record<ActivityType, RelationshipType[]>> = {
  start_milestone: ['SS', 'SF'],
  finish_milestone: ['FS', 'FF'],
}

export function validRelationshipTypesFor(successorType: ActivityType | undefined): RelationshipType[] {
  if (!successorType) return RELATIONSHIP_TYPES
  return VALID_RELATIONSHIP_TYPES_FOR_MILESTONE[successorType] ?? RELATIONSHIP_TYPES
}

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
  // 2026-07-13, per Maro: every activity on this calendar starts exactly at
  // day_start_time and finishes exactly at day_end_time, never mid-day — see
  // scheduling_cpm.py's own _CalendarLookup.add_duration/subtract_duration.
  whole_day_scheduling: boolean
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

// A PM-tagged sub-project — see docs/SUBPROJECT_FLOAT_PLAN.md (private docs
// repo). Tagging a nested WBS summary's root_wbs_id here gives its whole
// branch its own scoped float calculation (sub_total_float_hours/
// sub_is_critical on Activity), independent of the master critical path.
export interface ScheduleSubproject {
  id: string
  project_id: string
  name: string
  // Deferred (§G/§H of the plan) — no owning-party picker in the widget yet,
  // since `organisations` is this app's single-tenant-per-account model, not
  // a per-project roster of external delivery parties/subcontractors. Always
  // null until that's actually built.
  owning_party_org_id: string | null
  root_wbs_id: string
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
  schedule_period_id: string
  activity_count: number
  // null when activity_count is 0 — no activities means nothing to score,
  // not a 0%.
  logic_score: number | null
  checks: QualityCheck[]
  // Sub-project scope (2026-07-06, per Maro) — null = whole schedule
  // (default). Set = restricted to one tagged sub-project's own subtree,
  // with checks 6/7/12 reading sub_total_float_hours/sub_is_critical.
  scope_subproject_id: string | null
  scope_name: string | null
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
  schedule_period_id: string
  name: string
  created_at: string
  logic_score: number | null
  failing_count: number
  warning_count: number
  scope_subproject_id: string | null
  scope_name: string | null
}

export interface SchedulingQualityRunResponse {
  id: string
  schedule_period_id: string
  name: string
  created_at: string
  report: QualityReport
}

// Resources module (2026-07-02) — a project-scoped resource pool + per-activity
// assignments. No calendar of its own: a resource runs on whichever calendar(s)
// its assigned activities already use (docs/RESOURCES_MODULE_PLAN.md).
// cost/crew added 2026-07-08, per Maro (scoped down from a much larger external
// schema proposal — see project memory) — cost covers non-work-driven costs
// (fees, permits, prelims); crew occupies activity time the same way
// labour/equipment does.
export type ResourceType = 'labour' | 'equipment' | 'material' | 'subcontractor' | 'cost' | 'crew'

export const RESOURCE_TYPES: ResourceType[] = ['labour', 'equipment', 'material', 'subcontractor', 'cost', 'crew']
export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  labour: 'Labour',
  equipment: 'Equipment/Plant',
  material: 'Material',
  subcontractor: 'Subcontractor',
  cost: 'Cost',
  crew: 'Crew',
}

export type ResourceCostType = 'fixed' | 'recurring'

export interface Resource {
  id: string
  project_id: string
  resource_type: ResourceType
  name: string
  // Optional default/primary role (e.g. "Trades", "Foreman") — distinct from
  // a specific assignment's own role override (ResourceAssignment.role
  // below). Drives the Resource Usage Profile's own Role column
  // (2026-07-07, per Maro).
  role: string | null
  // Free-choice only for material (e.g. "m3", "nr"). For labour/equipment this is
  // always "day" (rate is a day rate); for subcontractor always "lump sum" —
  // frontend-enforced, not user-editable for those two types.
  unit: string
  rate: string
  // This resource's normal full-time daily capacity in hours (e.g. 8) — only
  // meaningful for labour/equipment; informational, not a cost multiplier (an
  // assignment's utilisation_pct already expresses "how much of the day").
  max_hours_per_day: string
  // Optional own calendar (2026-07-07, per Maro) — null means no calendar of
  // its own, the original default; storage/display only for now, the CPM
  // engine still schedules purely off each activity's own calendar.
  calendar_id: string | null
  // Classification fields (2026-07-08, per Maro) — free text, shown/used per
  // resource_type by the form only; none feed the budget formula.
  discipline: string | null
  company: string | null
  skill_level: string | null
  category: string | null
  cost_type: ResourceCostType | null
  members: string | null
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
  schedule_period_id: string
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
  | 'variance_days' | 'total_float_hours' | 'free_float_hours' | 'sub_total_float_hours' | 'sub_is_critical'
  | 'pct_complete' | 'duration_pct_complete'
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

// Same shape as SchedulingFilter — a highlight rule is built from the same
// conditions, just tinting a matching row instead of narrowing the list
// (2026-07-06, per Maro: "works exactly like the filter").
export interface SchedulingHighlight {
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
  { key: 'sub_total_float_hours', label: 'Sub Total Float (h)', type: 'number', operators: NUMBER_OPERATORS },
  { key: 'sub_is_critical', label: 'Sub Critical', type: 'boolean', operators: BOOLEAN_OPERATORS },
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

// User Defined Fields (2026-07-07, per Maro — P6's own UDF dialog:
// docs/SCHEDULING_GAPS_PLAN.md Phase 9). "cost_element" matches the
// backend's own model/table name, not "cost". Mirrors
// app/schemas/user_defined_field.py exactly.
export type UdfEntityType = 'activity' | 'resource' | 'cost_element'
export type UdfDataType = 'text' | 'number' | 'integer' | 'cost' | 'start_date' | 'finish_date' | 'indicator'

export const UDF_DATA_TYPES: { value: UdfDataType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'cost', label: 'Cost' },
  { value: 'start_date', label: 'Start Date' },
  { value: 'finish_date', label: 'Finish Date' },
  { value: 'indicator', label: 'Indicator' },
]

// Fixed 8-state icon/colour set for the "indicator" data type — exact set
// and colours per Maro's own P6 reference screenshot, 2026-07-07.
export type IndicatorValue =
  'none' | 'in_progress' | 'delayed' | 'at_risk' | 'problem' | 'paused' | 'cancelled' | 'completed'

export const INDICATOR_OPTIONS: { value: IndicatorValue; label: string; icon: string; color: string }[] = [
  { value: 'none', label: 'None', icon: '–', color: '#9ca3af' },
  { value: 'in_progress', label: 'In Progress', icon: '◐', color: '#22d3ee' },
  { value: 'delayed', label: 'Delayed', icon: '◆', color: '#f97316' },
  { value: 'at_risk', label: 'At risk', icon: '▲', color: '#eab308' },
  { value: 'problem', label: 'Problem', icon: '●', color: '#ef4444' },
  { value: 'paused', label: 'Paused', icon: '❚❚', color: '#3b82f6' },
  { value: 'cancelled', label: 'Cancelled', icon: '✕', color: '#6b7280' },
  { value: 'completed', label: 'Completed', icon: '✓', color: '#22c55e' },
]

export function indicatorOption(value: string | null | undefined) {
  return INDICATOR_OPTIONS.find(o => o.value === value) ?? INDICATOR_OPTIONS[0]
}

export interface UserDefinedFieldDefinition {
  id: string
  project_id: string
  entity_type: UdfEntityType
  name: string
  data_type: UdfDataType
  created_at: string
  updated_at: string
}

export interface UserDefinedFieldValue {
  id: string
  field_definition_id: string
  record_id: string
  value_text: string | null
  value_number: string | null
  value_date: string | null
  value_indicator: string | null
}

// P6's per-activity ordered checklist (docs/SCHEDULING_GAPS_PLAN.md Phase
// 10) — name + boolean complete + manual ordering only. Mirrors
// app/schemas/activity_step.py exactly.
export interface ActivityStep {
  id: string
  activity_id: string
  name: string
  is_complete: boolean
  sort_order: number
  created_at: string
  updated_at: string
}
