import { useMemo } from 'react'
import { ActivityPicker } from '@/modules/scheduling/ActivityPicker'
import type { Activity, UserDefinedFieldDefinition, UserDefinedFieldValue } from '@/modules/scheduling/types'
import { stringifyUdfValue, type ScopeFilter } from './scheduleScope'

// Shared "which Activities does this widget track" controls (2026-08-03),
// used by both RadialChartsPanel.tsx and TimelineStripPanel.tsx — a single
// place for the All/UDF/WBS mode selector so the two widgets' scope UIs
// can never drift apart. Always emits a *complete* ScopeFilter on change
// (not a partial patch) — switching modes clears the other mode's now-
// irrelevant fields in the same update, so a chart/strip never carries
// stale hidden udf_value or wbs_node_activity_id from a mode it's no
// longer in.
export function ScopeFilterFields({
  scope, activities, udfDefinitions, getUdfValue, onChange,
}: {
  scope: ScopeFilter
  activities: Activity[]
  udfDefinitions: UserDefinedFieldDefinition[]
  getUdfValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined
  onChange: (scope: ScopeFilter) => void
}) {
  const emptyScope: ScopeFilter = { scope_mode: 'all', udf_field_definition_id: null, udf_value: null, wbs_node_activity_id: null }

  // Distinct values actually present for the currently-chosen UDF field,
  // e.g. every real "Sub Discipline" value some Activity already carries —
  // a free-text input would let a filter target a value that matches
  // nothing, silently reading as 0%/empty forever.
  const valueOptions = useMemo(() => {
    if (scope.scope_mode !== 'udf' || !scope.udf_field_definition_id) return []
    const seen = new Set<string>()
    for (const activity of activities) {
      const v = stringifyUdfValue(getUdfValue(scope.udf_field_definition_id, activity.id))
      if (v !== null) seen.add(v)
    }
    return [...seen].sort()
  }, [scope.scope_mode, scope.udf_field_definition_id, activities, getUdfValue])

  const wbsNodes = useMemo(() => activities.filter(a => a.activity_type === 'wbs_summary'), [activities])

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted" title="Which Activities this widget tracks — leave as 'All Activities' to show the whole project">
        <span className="w-16 shrink-0">Scope</span>
        <select
          value={scope.scope_mode}
          onChange={e => onChange({ ...emptyScope, scope_mode: e.target.value as ScopeFilter['scope_mode'] })}
          className="flex-1 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
        >
          <option value="all">All Activities</option>
          <option value="udf">UDF Value</option>
          <option value="wbs">WBS Node</option>
        </select>
      </label>
      {scope.scope_mode === 'udf' && (
        <>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-16 shrink-0">Field</span>
            <select
              value={scope.udf_field_definition_id ?? ''}
              onChange={e => onChange({ ...scope, udf_field_definition_id: e.target.value || null, udf_value: null })}
              className="flex-1 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            >
              <option value="">Choose a field…</option>
              {udfDefinitions.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          {scope.udf_field_definition_id && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
              <span className="w-16 shrink-0">Value</span>
              <select
                value={scope.udf_value ?? ''}
                onChange={e => onChange({ ...scope, udf_value: e.target.value || null })}
                className="flex-1 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
              >
                <option value="">Choose a value…</option>
                {valueOptions.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      {scope.scope_mode === 'wbs' && (
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
          <span className="w-16 shrink-0">WBS Node</span>
          <ActivityPicker
            activities={wbsNodes}
            value={scope.wbs_node_activity_id ?? ''}
            onChange={id => onChange({ ...scope, wbs_node_activity_id: id })}
            placeholder="Select a WBS node…"
            className="flex-1"
          />
        </label>
      )}
    </div>
  )
}
