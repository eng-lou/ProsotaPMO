export type ActivityType = 'task' | 'milestone' | 'wbs_summary'

export const ACTIVITY_TYPES: ActivityType[] = ['task', 'milestone', 'wbs_summary']

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
  start: string | null
  finish: string | null
  actual_start: string | null
  actual_finish: string | null
  remaining_duration_days: number | null
  // Computed server-side only (see backend app/services/activity.py). bl_start/
  // bl_finish stay null until Phase 6 (Set Baseline); total_float/is_critical stay
  // null until Phase 5 (CPM engine) — see docs/SCHEDULING_MODULE_PLAN.md.
  bl_start: string | null
  bl_finish: string | null
  variance_days: number | null
  total_float: number | null
  is_critical: boolean | null
  pct_complete: string | null
  commentary: string | null
  constraint_type: ConstraintType | null
  constraint_date: string | null
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
