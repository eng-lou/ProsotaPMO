import type { PaneConfig } from './comparisonPane'
import { resolveScopeActivityIds } from './scheduleScope'
import type { Activity, UserDefinedFieldValue } from '@/modules/scheduling/types'

export const paneCollectionIds = (config: PaneConfig): string[] =>
  [...new Set(config.collectionIds ?? (config.collectionId ? [config.collectionId] : []))]
export const paneScopes = (config: PaneConfig) => config.scopes ?? [config.scope]
export function resolvePaneScopeIds(config: PaneConfig, activities: Activity[], getValue: (field: string, record: string) => UserDefinedFieldValue | undefined) {
  const ids = new Set<string>()
  for (const scope of paneScopes(config)) {
    // An unfinished extra row must not accidentally include the entire model.
    if (scope.scope_mode === 'udf' && (!scope.udf_field_definition_id || !scope.udf_value)) continue
    for (const id of resolveScopeActivityIds(activities, scope, getValue)) ids.add(id)
  }
  return ids
}
