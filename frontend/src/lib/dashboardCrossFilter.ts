import { api } from './api'

// Cross-widget "click to filter" (2026-09-06, per Maro: "if i click say
// roof slab in the critical activities table... it should interact with
// the other dashboards in the current layout so like a filter... clicking
// again can default it... like how Power BI acts"). A sibling to the
// per-widget saved DashboardFilterCondition mechanism (lib/dashboardFilters.ts)
// — that one is a manually-configured, persisted filter; this one is a
// transient, interactively-set scope shared by every widget on the page
// at once, reset by clicking the same source again.
//
// Source side is deliberately activity-only for this first pass, per
// Maro's own two named examples (a Critical Activities row, a Float
// Distribution bar) — every widget clickable as a *source* resolves to a
// set of activity ids. Target side is broader: any widget reading
// risks/cost_elements/icd_items/resource_assignments/schedule_activities/
// milestones narrows down to whatever's actually related to those seed
// activities (backend/app/services/dashboard.py:get_related_records) —
// a real, structural CostElement.linked_activity_id link, or a genuine
// RecordLink causal edge, never a guess. A Risk/Issue/Change/Decision
// with no such link simply has nothing to show while a cross-filter is
// active (per Maro: "if the causal links are connected then show, if
// not just blank") — it's excluded, not greyed out separately, since an
// empty widget already communicates that.
export interface CrossFilterScope {
  // Identifies *what* is currently selected (e.g. "activity:<id>" for a
  // single row, "float_bucket:<label>" for a chart bucket) so a second
  // click on the exact same source toggles it off instead of re-selecting
  // the same scope — see toggleCrossFilterSeed below.
  key: string
  activityIds: Set<string>
  costElementIds: Set<string>
  riskIds: Set<string>
  icdItemIds: Set<string>
}

export interface RelatedRecordsResponse {
  activity_ids: string[]
  cost_element_ids: string[]
  risk_ids: string[]
  icd_item_ids: string[]
}

export async function fetchRelatedRecords(projectId: string, activityIds: string[]): Promise<RelatedRecordsResponse> {
  // Built as a real query string, not axios's own params/paramsSerializer
  // (whose array-serialization default doesn't match what FastAPI's
  // `activity_ids: list[uuid.UUID] = Query(...)` expects — repeated
  // `activity_ids=a&activity_ids=b`, no brackets/indices) — unambiguous
  // either way, and avoids depending on an axios version detail.
  const search = new URLSearchParams({ project_id: projectId })
  for (const id of activityIds) search.append('activity_ids', id)
  const { data } = await api.get<RelatedRecordsResponse>(`/api/v1/dashboard/related-records?${search.toString()}`)
  return data
}

export type CrossFilterEntityKind = 'activity' | 'cost_element' | 'risk' | 'icd_item'

// Every widget's own filter predicate — true when no cross-filter is
// active at all (matches evaluateDashboardFilter's own "no conditions ->
// show everything" convention), otherwise membership in the one id set
// this entity kind actually resolves against.
export function matchesCrossFilter(id: string, kind: CrossFilterEntityKind, scope: CrossFilterScope | null | undefined): boolean {
  if (!scope) return true
  switch (kind) {
    case 'activity': return scope.activityIds.has(id)
    case 'cost_element': return scope.costElementIds.has(id)
    case 'risk': return scope.riskIds.has(id)
    case 'icd_item': return scope.icdItemIds.has(id)
  }
}

// Toggle semantics for a click-to-set source (2026-09-06, per Maro:
// "clicking again can default it") — clicking the same key that's already
// active clears the cross-filter entirely; clicking a different key (or
// clicking when nothing is active) sets/replaces it. Callers pass this as
// their onCrossFilterClick prop's implementation.
export function toggleCrossFilterKey(current: CrossFilterScope | null, key: string): string | null {
  return current?.key === key ? null : key
}
