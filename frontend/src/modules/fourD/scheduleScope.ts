import type { Activity, UserDefinedFieldValue } from '@/modules/scheduling/types'

// Shared "which Activities does this widget track" concept (2026-08-03),
// used by both Radial Chart and Timeline Strip — generalized out of
// radialChartProgress.ts's own original UDF-only matchingActivityIds once
// Maro asked for the same WBS-node scoping on both widgets. 'all' = every
// Activity in the project (the original null-fields behaviour both widgets
// already defaulted to); 'udf' = a single User Defined Field value match;
// 'wbs' = every real task/milestone under one chosen WBS node's own
// subtree.
export type ScopeMode = 'all' | 'udf' | 'wbs'

export interface ScopeFilter {
  scope_mode: ScopeMode
  udf_field_definition_id: string | null
  udf_value: string | null
  wbs_node_activity_id: string | null
}

// Whichever of a UDF value's four value_* columns is actually populated,
// stringified — generic across data_type so a filter isn't hard-limited to
// "text" UDFs even though "Sub Discipline"-style text fields are the
// primary use case (per Maro's own example).
export function stringifyUdfValue(value: UserDefinedFieldValue | undefined): string | null {
  if (!value) return null
  return value.value_text ?? value.value_number ?? value.value_date ?? value.value_indicator ?? null
}

// Every real (non-WBS-summary) descendant of `rootId`, walked via
// Activity.parent_id — the frontend equivalent of
// backend/app/services/activity.py's own _subtree_ids, just built from an
// already-in-memory activities array instead of a fresh query (Activities
// are already fully loaded client-side wherever this runs). wbs_summary
// rows themselves (the root and any nested phase/summary rows) are
// deliberately excluded from the returned set — they carry no meaningful
// duration of their own for a duration-weighted progress calc, and
// computeScheduleRange (timelinePlayback.ts) already excludes them from
// date-range computation the same way, so including them here would
// double-count a summary's own roll-up span on top of its children's.
function wbsSubtreeActivityIds(activities: Activity[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, Activity[]>()
  for (const activity of activities) {
    if (!activity.parent_id) continue
    const siblings = childrenByParent.get(activity.parent_id)
    if (siblings) siblings.push(activity)
    else childrenByParent.set(activity.parent_id, [activity])
  }
  const matches = new Set<string>()
  const visit = (nodeId: string) => {
    for (const child of childrenByParent.get(nodeId) ?? []) {
      if (child.activity_type !== 'wbs_summary') matches.add(child.id)
      visit(child.id)
    }
  }
  visit(rootId)
  return matches
}

// Which Activity ids a widget's scope filter currently matches. A field/
// node chosen with no value/target yet matches nothing rather than
// everything, so a half-configured widget reads as 0%/empty instead of
// misleadingly "100% of everything."
export function resolveScopeActivityIds(
  activities: Activity[],
  scope: ScopeFilter,
  getUdfValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined,
): Set<string> {
  if (scope.scope_mode === 'wbs') {
    if (!scope.wbs_node_activity_id) return new Set()
    return wbsSubtreeActivityIds(activities, scope.wbs_node_activity_id)
  }
  if (scope.scope_mode === 'udf') {
    if (!scope.udf_field_definition_id) return new Set(activities.map(a => a.id))
    if (!scope.udf_value) return new Set()
    const matches = new Set<string>()
    for (const activity of activities) {
      if (stringifyUdfValue(getUdfValue(scope.udf_field_definition_id, activity.id)) === scope.udf_value) {
        matches.add(activity.id)
      }
    }
    return matches
  }
  return new Set(activities.map(a => a.id))
}
