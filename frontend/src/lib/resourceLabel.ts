import type { ResourceAssignment } from '@/modules/scheduling/types'

// Shared between Cost Plan's and Activities' own "Group by Resource" (2026-07-10,
// per Maro) — an activity/cost-element with multiple resource assignments gets one
// combined-name group key (e.g. "Steel Fixers, 360 Excavator") rather than fanning
// out into multiple groups, keeping the single-key-per-row grouping invariant both
// call sites already rely on.
export function resourceLabelForActivity(activityId: string | null, assignments: ResourceAssignment[]): string {
  if (activityId === null) return '(none)'
  const names = assignments.filter(a => a.activity_id === activityId).map(a => a.resource_name)
  return names.length === 0 ? '(none)' : names.join(', ')
}
