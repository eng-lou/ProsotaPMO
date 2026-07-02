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
}

export interface QualityReport {
  period_id: string
  activity_count: number
  logic_score: number
  checks: QualityCheck[]
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
