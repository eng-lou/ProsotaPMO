import type { ResourceAssignment } from '@/modules/scheduling/types'

// Groups a flat assignments list by activity_id once (2026-07-15, per Maro:
// "its very laggy" — the Scheduling Activities grid was calling
// resourceLabelForActivity, below, once per *row*, each call doing its own
// full `.filter()` over every assignment in the project — real O(activities
// × assignments) work redone on every render, and a real freeze on a
// generate-schedule-sized activity list. Callers with a large, frequently-
// rendered activity set (Scheduling.tsx) should build this once per
// resourceAssignments change and pass it into resourceLabelForActivity
// instead of the raw array; smaller/less-hot call sites (Cost Plan) can keep
// passing the array directly — see that function's own overload below.
export function groupAssignmentsByActivityId(assignments: ResourceAssignment[]): Map<string, ResourceAssignment[]> {
  const map = new Map<string, ResourceAssignment[]>()
  for (const a of assignments) {
    const list = map.get(a.activity_id)
    if (list) list.push(a)
    else map.set(a.activity_id, [a])
  }
  return map
}

// Shared between Cost Plan's and Activities' own "Group by Resource" (2026-07-10,
// per Maro) — an activity/cost-element with multiple resource assignments gets one
// combined-name group key (e.g. "Steel Fixers, 360 Excavator") rather than fanning
// out into multiple groups, keeping the single-key-per-row grouping invariant both
// call sites already rely on.
//
// Accepts either the raw assignments array (a fresh O(n) filter each call —
// fine for Cost Plan's own smaller, less frequently re-rendered element
// list) or a pre-grouped Map from groupAssignmentsByActivityId above (an O(1)
// lookup — what Scheduling.tsx's own hot Activities grid now uses).
export function resourceLabelForActivity(
  activityId: string | null,
  assignments: ResourceAssignment[] | Map<string, ResourceAssignment[]>,
): string {
  if (activityId === null) return '(none)'
  const matches = Array.isArray(assignments)
    ? assignments.filter(a => a.activity_id === activityId)
    : assignments.get(activityId) ?? []
  const names = matches.map(a => a.resource_name)
  return names.length === 0 ? '(none)' : names.join(', ')
}
