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
  duration_days: number | null
  // Computed by the CPM forward/backward pass (app/services/scheduling_cpm.py) from
  // duration + logic + calendar + constraints — never accepted as input from Phase 5
  // onward. wbs_summary rows are the exception: theirs are rollups from children.
  start: string | null
  finish: string | null
  actual_start: string | null
  actual_finish: string | null
  remaining_duration_days: number | null
  // Computed server-side only (see backend app/services/activity.py). bl_start/
  // bl_finish/bl_duration_days are set only by the "Set Baseline" action — null
  // until the first capture. total_float/free_float/is_critical are null for
  // wbs_summary rows (outside the CPM network).
  bl_start: string | null
  bl_finish: string | null
  bl_duration_days: number | null
  variance_days: number | null
  total_float: number | null
  free_float: number | null
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
  lag_days: number
  created_at: string
  updated_at: string
}

export interface Calendar {
  id: string
  project_id: string
  name: string
  is_project_default: boolean
  hours_per_day: string
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

export interface CalendarException {
  id: string
  calendar_id: string
  label: string
  start_date: string
  end_date: string
  is_working: boolean
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
