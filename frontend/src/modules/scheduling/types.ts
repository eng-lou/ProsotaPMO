export type ActivityType = 'task' | 'milestone' | 'wbs_summary'

export const ACTIVITY_TYPES: ActivityType[] = ['task', 'milestone', 'wbs_summary']

export interface Activity {
  id: string
  code: string
  project_id: string
  period_id: string
  task_name: string
  activity_type: ActivityType
  wbs_path: string | null
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
  created_at: string
  updated_at: string
}
